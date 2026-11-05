import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from './firebase';
import { workday } from './domain';
import { enqueue } from './sync';
import { localState } from './local';
import { visible } from './projection';
import type {
  AccountType,
  Entry,
  LineType,
  Member,
  Profile,
  Session,
} from './models';
export async function startSession(uid: string, openingCash: number) {
  const day = workday(),
    sessionId = `${uid}_${day}`;
  await enqueue('session', `session:${sessionId}`, {
    sessionId,
    workday: day,
    openingCash,
  });
  return visible(localState().records, localState().commands, uid)[
    `sessions/${sessionId}`
  ] as Session;
}
export async function saveEntry(
  id: string,
  sessionId: string,
  member: Member,
  values: Record<LineType, number>,
  uid: string,
  profile: Profile,
  details: {
    otherAccountId?: string;
    accountTypes?: Partial<Record<LineType, AccountType>>;
    note?: string;
  } = {},
) {
  if (uid !== auth.currentUser?.uid) throw new Error('Account changed.');
  await enqueue(
    'entry',
    `session:${sessionId}`,
    {
      entryId: id,
      sessionId,
      member,
      values,
      agentName: profile.displayName,
      otherAccountId: details.otherAccountId ?? '',
      accountTypes: details.accountTypes ?? {},
      note: details.note ?? '',
    },
    id,
  );
  return id;
}
export async function findSubmission(id: string) {
  const snap = await getDocFromServer(doc(db(), 'entries', id));
  return snap.exists() ? (snap.data() as Entry) : null;
}
export async function voidEntryLine(
  entry: Entry,
  type: LineType,
  reason: string,
  uid: string,
) {
  if (uid !== auth.currentUser?.uid) throw new Error('Account changed.');
  return enqueue('void', `session:${entry.sessionId}`, {
    entryId: entry.entryId,
    sessionId: entry.sessionId,
    type,
    reason,
  });
}
export async function setRecorded(
  entryId: string,
  type: LineType,
  recorded: boolean,
  _uid: string,
  _name: string,
) {
  const e = visible(
    localState().records,
    localState().commands,
    auth.currentUser!.uid,
  )[`entries/${entryId}`];
  return enqueue('record', `record:${entryId}:${type}`, {
    entryId,
    type,
    recorded,
    expectedRevision: e?.lines[type]?.recordingRevision ?? 0,
  });
}
