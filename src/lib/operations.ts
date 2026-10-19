import {
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { bounds, cash, MAX_RECORDING_EVENTS, workday } from './domain';
import {
  TYPES,
  type Entry,
  type Line,
  type LineType,
  type Member,
  type Profile,
  type Session,
} from './models';
const online = () => {
  if (!navigator.onLine) throw new Error('Offline — connect to make changes.');
};
function activeSession(s: Session) {
  if (s.workday !== workday() || s.endsAt.toMillis() <= Date.now())
    throw new Error("This session has ended. Start today's session.");
}
export async function startSession(uid: string, openingCash: number) {
  online();
  const day = workday(),
    id = `${uid}_${day}`,
    ref = doc(db(), 'sessions', id),
    times = bounds(day);
  return runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return snap.data() as Session;
    const s = {
      sessionId: id,
      agentId: uid,
      workday: day,
      startsAt: Timestamp.fromDate(times.start),
      endsAt: Timestamp.fromDate(times.end),
      openingCash,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalLoanInstalments: 0,
      expectedCash: openingCash,
      revision: 0,
      lastMutationId: '',
      createdAt: serverTimestamp(),
    };
    tx.set(ref, s);
    return s;
  });
}
export async function saveEntry(
  id: string,
  sessionId: string,
  member: Member,
  values: Record<LineType, number>,
  uid: string,
  profile: Profile,
) {
  online();
  const entryRef = doc(db(), 'entries', id),
    sessionRef = doc(db(), 'sessions', sessionId);
  return runTransaction(db(), async (tx) => {
    const [entrySnap, sessionSnap, memberSnap] = await Promise.all([
      tx.get(entryRef),
      tx.get(sessionRef),
      tx.get(doc(db(), 'members', member.memberId)),
    ]);
    if (entrySnap.exists()) {
      const prior = entrySnap.data() as Entry;
      if (
        prior.memberId !== member.memberId ||
        prior.sessionId !== sessionId ||
        TYPES.some((t) => (prior.lines[t]?.amount ?? 0) !== values[t])
      )
        throw new Error(
          'This submission ID already belongs to a saved entry. Check recent entries before starting another.',
        );
      return id;
    }
    if (!sessionSnap.exists()) throw new Error('Start a session first.');
    const s = sessionSnap.data() as Session,
      m = memberSnap.data() as Member | undefined;
    activeSession(s);
    if (
      !m?.active ||
      m.fullName !== member.fullName ||
      m.accountNumber !== member.accountNumber
    )
      throw new Error('This account changed. Select it again before saving.');
    const totalDeposits = s.totalDeposits + values.deposit,
      totalWithdrawals = s.totalWithdrawals + values.withdrawal,
      totalLoanInstalments = s.totalLoanInstalments + values.loanInstalment;
    const expectedCash = cash(
        s.openingCash,
        totalDeposits,
        totalWithdrawals,
        totalLoanInstalments,
      ),
      revision = s.revision + 1;
    const lines: Record<string, unknown> = {};
    for (const type of TYPES)
      if (values[type] > 0)
        lines[type] = {
          amount: values[type],
          state: 'active',
          recorded: false,
          recordedBy: null,
          recordedAt: null,
          voidedBy: null,
          voidedAt: null,
          voidReason: '',
          recordingRevision: 0,
          recordingHistory: {},
        };
    tx.set(entryRef, {
      entryId: id,
      sessionId,
      workday: s.workday,
      agentId: uid,
      agentNameSnapshot: profile.displayName,
      memberId: m.memberId,
      accountNumberSnapshot: m.accountNumber,
      memberNameSnapshot: m.fullName,
      createdAt: serverTimestamp(),
      financialRevision: revision,
      lines,
    });
    tx.update(sessionRef, {
      totalDeposits,
      totalWithdrawals,
      totalLoanInstalments,
      expectedCash,
      revision,
      lastMutationId: id,
    });
    return id;
  });
}
export async function findSubmission(id: string) {
  online();
  return (await getDocFromServer(doc(db(), 'entries', id))).exists();
}
export async function voidEntryLine(
  entry: Entry,
  type: LineType,
  reason: string,
  uid: string,
) {
  online();
  const eRef = doc(db(), 'entries', entry.entryId),
    sRef = doc(db(), 'sessions', entry.sessionId);
  await runTransaction(db(), async (tx) => {
    const [eSnap, sSnap] = await Promise.all([tx.get(eRef), tx.get(sRef)]);
    if (!eSnap.exists() || !sSnap.exists())
      throw new Error('This entry is unavailable.');
    const e = eSnap.data() as Entry,
      s = sSnap.data() as Session,
      l = e.lines[type];
    activeSession(s);
    if (!l || l.state === 'voided' || l.recorded || e.agentId !== uid)
      throw new Error('Only your active, unrecorded lines can be voided.');
    const totalDeposits = s.totalDeposits - (type === 'deposit' ? l.amount : 0),
      totalWithdrawals =
        s.totalWithdrawals - (type === 'withdrawal' ? l.amount : 0),
      totalLoanInstalments =
        s.totalLoanInstalments - (type === 'loanInstalment' ? l.amount : 0);
    const expectedCash = cash(
        s.openingCash,
        totalDeposits,
        totalWithdrawals,
        totalLoanInstalments,
      ),
      revision = s.revision + 1;
    tx.update(eRef, {
      [`lines.${type}.state`]: 'voided',
      [`lines.${type}.voidedBy`]: uid,
      [`lines.${type}.voidedAt`]: serverTimestamp(),
      [`lines.${type}.voidReason`]: reason.trim(),
      financialRevision: revision,
    });
    tx.update(sRef, {
      totalDeposits,
      totalWithdrawals,
      totalLoanInstalments,
      expectedCash,
      revision,
      lastMutationId: e.entryId,
    });
  });
}
export async function setRecorded(
  entryId: string,
  type: LineType,
  recorded: boolean,
  uid: string,
) {
  online();
  const ref = doc(db(), 'entries', entryId);
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This entry is unavailable.');
    const line = (snap.data() as Entry).lines[type] as Line;
    if (!line || line.state !== 'active')
      throw new Error('Voided entries cannot be recorded.');
    if (line.recorded === recorded) return;
    const revision = line.recordingRevision + 1;
    if (revision > MAX_RECORDING_EVENTS)
      throw new Error(
        'Audit limit reached. Contact the system owner; history must be preserved.',
      );
    tx.update(ref, {
      [`lines.${type}.recorded`]: recorded,
      [`lines.${type}.recordedBy`]: recorded ? uid : null,
      [`lines.${type}.recordedAt`]: recorded ? serverTimestamp() : null,
      [`lines.${type}.recordingRevision`]: revision,
      [`lines.${type}.recordingHistory.${revision}`]: {
        by: uid,
        at: serverTimestamp(),
        recorded,
      },
    });
  });
}
