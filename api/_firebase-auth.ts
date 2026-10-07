import { decodeProtectedHeader, importX509, jwtVerify } from 'jose';
import type { ServerEnvironment } from './_env.ts';

export class FirebaseAuthError extends Error {
  constructor(public status: 401 | 503, message: string) { super(message); }
}

type PublicKey = Awaited<ReturnType<typeof importX509>>;
type KeyCache = { expiresAt: number; keys: Map<string, PublicKey> };
let cache: KeyCache | undefined;
let pendingKeys: Promise<KeyCache> | undefined;
const certificatesUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const publicKeys = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache.keys;
  pendingKeys ??= (async () => {
    const response = await fetch(certificatesUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new FirebaseAuthError(503, 'Account verification is temporarily unavailable.');
    const certificates: unknown = await response.json();
    if (!certificates || typeof certificates !== 'object' || Array.isArray(certificates)) throw new FirebaseAuthError(503, 'Account verification is temporarily unavailable.');
    const keys = new Map<string, PublicKey>();
    for (const [kid, certificate] of Object.entries(certificates)) {
      if (typeof certificate !== 'string') throw new FirebaseAuthError(503, 'Account verification is temporarily unavailable.');
      keys.set(kid, await importX509(certificate, 'RS256'));
    }
    if (!keys.size) throw new FirebaseAuthError(503, 'Account verification is temporarily unavailable.');
    const maxAge = Number(response.headers.get('cache-control')?.match(/(?:^|[,\s])max-age=(\d+)/i)?.[1] ?? 0);
    const age = Number(response.headers.get('age') ?? 0);
    return { keys, expiresAt: Date.now() + Math.max(0, maxAge - (Number.isFinite(age) ? age : 0)) * 1_000 };
  })();
  try {
    cache = await pendingKeys;
    return cache.keys;
  } catch {
    throw new FirebaseAuthError(503, 'Account verification is temporarily unavailable.');
  } finally { pendingKeys = undefined; }
};

// Uses only Web Crypto and Google's public signing certificates so Node and
// Cloudflare share verification. No service-account private key is required.
// Matches https://firebase.google.com/docs/auth/admin/verify-id-tokens.
export const verifyFirebaseUser = async (authorization: string | null, environment: ServerEnvironment) => {
  if (!authorization || !/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 16_384) {
    throw new FirebaseAuthError(401, 'Please sign in again.');
  }
  const projectId = environment.FIREBASE_PROJECT_ID?.trim();
  if (!projectId || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new FirebaseAuthError(503, 'Account sign-in is not configured.');
  }
  const token = authorization.slice(7);
  let kid: string;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error();
    kid = header.kid;
  } catch { throw new FirebaseAuthError(401, 'Please sign in again.'); }
  const key = (await publicKeys()).get(kid);
  if (!key) throw new FirebaseAuthError(401, 'Please sign in again.');
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      requiredClaims: ['sub', 'exp', 'iat', 'auth_time'],
    });
    const now = Math.floor(Date.now() / 1_000);
    if (payload.aud !== projectId || typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 128
      || typeof payload.iat !== 'number' || payload.iat > now
      || typeof payload.auth_time !== 'number' || payload.auth_time > now || payload.auth_time < 0) throw new Error();
    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      displayName: typeof payload.name === 'string' ? payload.name.slice(0, 80) : undefined,
    };
  } catch { throw new FirebaseAuthError(401, 'Your account session could not be verified.'); }
};
