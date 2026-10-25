import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { usernameEmail } from '../src/lib/domain';
const [projectId, uid, username, displayName, role] = process.argv.slice(2);
if (
  !projectId ||
  !uid ||
  !username ||
  !displayName ||
  !['agent', 'viewer', 'admin'].includes(role)
)
  throw new Error(
    'Usage: npm run profile:user -- PROJECT_ID AUTH_UID USERNAME "Display Name" agent|viewer|admin',
  );
initializeApp({ credential: applicationDefault(), projectId });
const identity = await getAuth().getUser(uid);
if (identity.email?.toLowerCase() !== usernameEmail(username))
  throw new Error(
    'Auth account email does not match the normalized internal username identity.',
  );
const ref = getFirestore().doc(`users/${uid}`),
  old = await ref.get();
const normalized = username.trim().toLowerCase();
const duplicates = await getFirestore()
  .collection('users')
  .where('username', '==', normalized)
  .get();
if (duplicates.docs.some((d) => d.id !== uid))
  throw new Error('This username already has another profile.');
await ref.set({
  username: normalized,
  displayName,
  role,
  active: true,
  createdAt: old.exists ? old.data()!.createdAt : FieldValue.serverTimestamp(),
});
console.log(
  `Profile configured in ${projectId} for UID ${uid}. No password was read or stored.`,
);
