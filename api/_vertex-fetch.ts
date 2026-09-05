import type { ServerEnvironment } from './_env.ts';

type VertexMessage = { role: 'system' | 'user'; content: string };

type VertexCompletion = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

type GroundedVertexResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    groundingMetadata?: {
      webSearchQueries?: unknown;
      groundingChunks?: Array<{ web?: { uri?: unknown; title?: unknown } }>;
    };
  }>;
};

export type GroundedResearchResponse = {
  content: string;
  queries: string[];
  sources: Array<{ title: string; url: string }>;
};

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

type CompleteServiceAccount = {
  client_email: string;
  private_key: string;
};

type TokenCacheEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCacheEntry>();

const encodeBase64Url = (value: string | Uint8Array): string => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const decodePrivateKey = (pem: string): ArrayBuffer => {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/gu, '');
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer;
};

const readServiceAccount = (environment: ServerEnvironment): { projectId: string; account: CompleteServiceAccount } => {
  const projectId = environment.GOOGLE_CLOUD_PROJECT?.trim();
  const rawCredentials = environment.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!projectId || !rawCredentials) throw new Error('Google Cloud credentials are not configured.');
  let account: ServiceAccount;
  try {
    account = JSON.parse(rawCredentials) as ServiceAccount;
  } catch {
    throw new Error('Google Cloud service-account JSON is invalid.');
  }
  if (!account.client_email || !account.private_key) throw new Error('Google Cloud service-account JSON is incomplete.');
  return { projectId, account: { client_email: account.client_email, private_key: account.private_key } };
};

const getAccessToken = async (environment: ServerEnvironment): Promise<string> => {
  const { projectId, account } = readServiceAccount(environment);
  const cacheKey = `${projectId}:${account.client_email}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const now = Math.floor(Date.now() / 1_000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = encodeBase64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3_600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodePrivateKey(account.private_key.replaceAll('\\n', '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsignedToken),
  );
  const assertion = `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenBody = await tokenResponse.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description || 'Google Cloud access token could not be created.');
  }
  tokenCache.set(cacheKey, {
    token: tokenBody.access_token,
    expiresAt: Date.now() + Math.max(60, tokenBody.expires_in ?? 3_600) * 1_000,
  });
  return tokenBody.access_token;
};

/** Native fetch implementation for Cloudflare Workers. */
export const requestVertexCompletion = async (
  messages: VertexMessage[],
  environment: ServerEnvironment,
): Promise<string> => {
  const { projectId } = readServiceAccount(environment);
  const accessToken = await getAccessToken(environment);
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/endpoints/openapi/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3.7-flash',
        messages,
        response_format: { type: 'json_object' },
        max_completion_tokens: 4_096,
        reasoning_effort: 'low',
      }),
    },
  );
  const body = await response.json() as VertexCompletion & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || 'The Gemini provider returned an error.');
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('The Gemini provider returned an incomplete response.');
  return content;
};

/** Uses the native Gemini endpoint so Google Search grounding metadata remains available. */
export const requestVertexGroundedResearch = async (
  prompt: string,
  environment: ServerEnvironment,
): Promise<GroundedResearchResponse> => {
  const { projectId } = readServiceAccount(environment);
  const accessToken = await getAccessToken(environment);
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/publishers/google/models/gemini-3.7-flash:generateContent`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          maxOutputTokens: 8_192,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    },
  );
  const body = await response.json() as GroundedVertexResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || 'The Gemini research provider returned an error.');
  const candidate = body.candidates?.[0];
  const content = candidate?.content?.parts
    ?.map((part) => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();
  if (!content) throw new Error('The Gemini research provider returned no content.');
  const metadata = candidate?.groundingMetadata;
  const queries = Array.isArray(metadata?.webSearchQueries)
    ? metadata.webSearchQueries.filter((query): query is string => typeof query === 'string')
    : [];
  const sourceByUrl = new Map<string, string>();
  for (const chunk of metadata?.groundingChunks ?? []) {
    const url = chunk.web?.uri;
    if (typeof url !== 'string' || !url.startsWith('https://')) continue;
    const title = typeof chunk.web?.title === 'string' && chunk.web.title.trim() ? chunk.web.title : url;
    sourceByUrl.set(url, title);
  }
  return { content, queries, sources: [...sourceByUrl].map(([url, title]) => ({ url, title })) };
};
