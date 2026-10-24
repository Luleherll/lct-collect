import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { bounds, usernameEmail, workday } from '../src/lib/domain';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
for (const host of [
  process.env.FIRESTORE_EMULATOR_HOST,
  process.env.FIREBASE_AUTH_EMULATOR_HOST,
])
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host!))
    throw new Error('Seed scripts run against local emulators only.');
initializeApp({ projectId: 'demo-lct-collect' });
const db = getFirestore(),
  auth = getAuth(),
  day = workday(),
  times = bounds(day);
for (const role of ['agent', 'viewer', 'admin'] as const) {
  const uid = `demo-${role}`,
    username = `demo.${role}`;
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({
      uid,
      email: usernameEmail(username),
      password: 'CollectDemo123!',
      displayName: `Demo ${role}`,
    });
  }
  await db.doc(`users/${uid}`).set({
    username,
    displayName: `Demo ${role}`,
    role,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  });
}
const count = Number(process.env.LCT_SEED_MEMBERS ?? 6);
if (!Number.isInteger(count) || count < 6 || count > 1000)
  throw new Error('Seed member count must be 6–1000.');
for (let i = 1; i <= count; i++)
  await db.doc(`members/${String(i).padStart(3, '0')}`).set({
    memberId: String(i).padStart(3, '0'),
    accountNumber:
      i === 7
        ? '0000000000000000000000000000000000000007'
        : `000401001${String(i).padStart(3, '0')}`,
    uniqueNumber:
      i === 8
        ? 'LCT006'
        : i === 9
          ? 'ABC 2'
          : `LCT${String(i).padStart(3, '0')}`,
    fullName:
      i === 8
        ? 'Example Member 6'
        : i === 9
          ? 'Example Group'
          : i === 7
            ? 'Example Member with a deliberately long synthetic name for narrow screen testing'
            : `Example Member ${i}`,
    searchName:
      i === 8
        ? 'example member 6'
        : i === 9
          ? 'example group'
          : i === 7
            ? 'example member with a deliberately long synthetic name for narrow screen testing'
            : `example member ${i}`,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
const sid = `demo-agent_${day}`,
  ref = db.doc(`sessions/${sid}`);
if (!(await ref.get()).exists) {
  const entryId = `emulator_${day.replaceAll('-', '')}`,
    at = Timestamp.now();
  await ref.set({
    sessionId: sid,
    agentId: 'demo-agent',
    workday: day,
    startsAt: Timestamp.fromDate(times.start),
    endsAt: Timestamp.fromDate(times.end),
    openingCash: 100000,
    totalDeposits: 10000,
    totalWithdrawals: 0,
    totalLoanInstalments: 25000,
    expectedCash: 135000,
    revision: 1,
    lastMutationId: entryId,
    createdAt: at,
  });
  const line = (amount: number) => ({
    amount,
    state: 'active',
    recorded: false,
    recordedBy: null,
    recordedAt: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: '',
    recordingRevision: 0,
    recordingHistory: {},
  });
  await db.doc(`entries/${entryId}`).set({
    entryId,
    sessionId: sid,
    agentId: 'demo-agent',
    agentNameSnapshot: 'Demo agent',
    workday: day,
    memberId: '001',
    accountNumberSnapshot: '000401001001',
    uniqueNumberSnapshot: 'LCT001',
    memberNameSnapshot: 'Example Member 1',
    createdAt: at,
    financialRevision: 1,
    lines: { deposit: line(10000), loanInstalment: line(25000) },
  });
}
console.log(
  'Local emulator demo ready. Usernames: demo.agent, demo.viewer, demo.admin. Password: CollectDemo123!',
);
