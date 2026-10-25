import { initializeApp } from 'firebase/app';
import { storage } from './storage';
import {
  connectAuthEmulator,
  initializeAuth,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
  signOut,
} from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from 'firebase/firestore';

const env = import.meta.env;
const emulators = env.PUBLIC_USE_EMULATORS === 'true';
const projectId = emulators
  ? 'demo-lct-collect'
  : env.PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId || !env.PUBLIC_FIREBASE_API_KEY)
  throw new Error(
    'Firebase configuration is missing. Set the public environment variables before building.',
  );
if (
  env.PUBLIC_APP_ENV !== 'production' &&
  !emulators &&
  projectId !== 'lct-collect-staging'
)
  throw new Error(
    'Non-production builds must use the isolated staging Firebase project.',
  );
if (
  env.PUBLIC_APP_ENV === 'production' &&
  (emulators ||
    projectId === 'lct-collect-staging' ||
    projectId.startsWith('demo-'))
)
  throw new Error(
    'Production builds require a separate production Firebase project.',
  );
const app = initializeApp({
  apiKey: env.PUBLIC_FIREBASE_API_KEY,
  authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId,
  appId: env.PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
});
export const auth = initializeAuth(app, {
  persistence: [browserSessionPersistence, inMemoryPersistence],
});
export let memoryOnlySession = false;
export let recordCacheAvailable = true;
export async function prepareLogin() {
  const available = storage.set('session', 'lct-auth-storage-check', '1');
  storage.remove('session', 'lct-auth-storage-check');
  memoryOnlySession = !available;
  try {
    await setPersistence(
      auth,
      available ? browserSessionPersistence : inMemoryPersistence,
    );
  } catch {
    memoryOnlySession = true;
    await setPersistence(auth, inMemoryPersistence);
  }
}
let database: ReturnType<typeof initializeFirestore> | undefined;
export function db() {
  if (!database) {
    // Multi-tab persistence needs Web Storage as well as IndexedDB. If the
    // browser denies it, keep the online app usable with a memory-only cache.
    recordCacheAvailable = storage.set('local', 'lct-cache-storage-check', '1');
    storage.remove('local', 'lct-cache-storage-check');
    database = initializeFirestore(app, {
      localCache: recordCacheAvailable
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
    });
    if (emulators) connectFirestoreEmulator(database, '127.0.0.1', 8080);
  }
  return database;
}
if (emulators)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
export async function logout() {
  await signOut(auth);
  let cleared = true;
  if (database) {
    await terminate(database);
    try {
      await clearIndexedDbPersistence(database);
    } catch {
      cleared = false;
    }
  }
  try {
    storage.remove('local', 'lct-trusted-device');
  } catch {
    /* Storage may be disabled. */
  }
  if (!cleared)
    storage.set(
      'session',
      'lct-cache-warning',
      'Close other LCT Collect tabs and clear site data on this device to remove its saved records.',
    );
  window.location.replace('/login/');
}
