import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signOut } from 'firebase/auth';
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
export const auth = getAuth(app);
let database: ReturnType<typeof initializeFirestore> | undefined;
export function db() {
  if (!database) {
    let trusted = false;
    try {
      trusted = localStorage.getItem('lct-trusted-device') === 'yes';
    } catch {
      /* Memory cache remains available. */
    }
    database = initializeFirestore(app, {
      localCache: trusted
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
    localStorage.removeItem('lct-trusted-device');
  } catch {
    /* Storage may be disabled. */
  }
  if (!cleared)
    sessionStorage.setItem(
      'lct-cache-warning',
      'Close other LCT Collect tabs and clear site data on this device to remove its saved records.',
    );
  window.location.replace('/login/');
}
