import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  terminate,
  where,
} from 'firebase/firestore';
import { strict as assert } from 'node:assert';
import { usernameEmail, workday } from '../src/lib/domain';
if (
  process.env.GCLOUD_PROJECT !== 'demo-lct-collect' ||
  !process.env.FIRESTORE_EMULATOR_HOST
)
  throw new Error('Run this only through the demo emulator command.');
for (const role of ['agent', 'viewer', 'admin'] as const) {
  const app = initializeApp(
      { projectId: 'demo-lct-collect', apiKey: 'demo-api-key' },
      role,
    ),
    auth = getAuth(app),
    db = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const result = await signInWithEmailAndPassword(
    auth,
    usernameEmail(`demo.${role}`),
    'CollectDemo123!',
  );
  assert.equal(
    (await getDoc(doc(db, 'users', result.user.uid))).data()?.role,
    role,
  );
  assert.equal(
    (
      await getDocs(
        query(collection(db, 'members'), where('active', '==', true)),
      )
    ).size,
    6,
  );
  if (role !== 'admin') {
    const conditions =
      role === 'agent'
        ? [
            where('agentId', '==', result.user.uid),
            where('workday', '==', workday()),
          ]
        : [where('workday', '==', workday())];
    assert.equal(
      (await getDocs(query(collection(db, 'entries'), ...conditions))).size,
      1,
    );
  }
  await signOut(auth);
  await terminate(db);
  await deleteApp(app);
  console.log(
    `${role}: Auth sign-in, profile and permitted data queries passed.`,
  );
}
