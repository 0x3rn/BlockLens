import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, inMemoryPersistence } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = Object.values(config).every((value) => Boolean(value?.trim()));
const app = isFirebaseConfigured
  ? getApps().find((candidate) => candidate.name === 'blocklens') ?? initializeApp(config, 'blocklens')
  : null;

// Firebase's default local persistence restores sign-in and syncs sign-out
// across tabs. Account records continue to live in Neon, not browser storage.
export const firebaseAuth = app ? initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
}) : null;

export const getAccountToken = async (forceRefresh = false): Promise<string | null> => {
  if (!firebaseAuth) return null;
  await firebaseAuth.authStateReady();
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken(forceRefresh);
  return firebaseAuth.currentUser?.uid === user.uid ? token : null;
};
