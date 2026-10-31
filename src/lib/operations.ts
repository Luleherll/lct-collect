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
  type AccountType,
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
  details: {
    otherAccountId?: string;
    accountTypes?: Partial<Record<LineType, AccountType>>;
    note?: string;
  } = {},
) {
  online();
  const entryRef = doc(db(), 'entries', id),
    sessionRef = doc(db(), 'sessions', sessionId);
  return runTransaction(db(), async (tx) => {
    const [entrySnap, sessionSnap, memberSnap, otherSnap] = await Promise.all([
      tx.get(entryRef),
      tx.get(sessionRef),
      tx.get(doc(db(), 'members', member.memberId)),
      details.otherAccountId
        ? tx.get(doc(db(), 'members', details.otherAccountId))
        : Promise.resolve(null),
    ]);
    if (entrySnap.exists()) {
      const prior = entrySnap.data() as Entry;
      if (
        prior.memberId !== member.memberId ||
        prior.sessionId !== sessionId ||
        (prior.note ?? '') !== (details.note?.trim() ?? '') ||
        (prior.otherAccountId ?? '') !== (details.otherAccountId ?? '') ||
        TYPES.some(
          (t) =>
            values[t] > 0 &&
            prior.lines[t]?.accountType !== details.accountTypes?.[t],
        ) ||
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
      m.accountNumber !== member.accountNumber ||
      m.uniqueNumber !== member.uniqueNumber
    )
      throw new Error('This account changed. Select it again before saving.');
    const note = details.note?.trim() ?? '';
    if (note.length > 2000)
      throw new Error('Keep notes within 2,000 characters.');
    if (details.otherAccountId) {
      const other = otherSnap?.data() as Member | undefined;
      if (
        !other?.active ||
        other.memberId === m.memberId ||
        !m.uniqueNumber ||
        other.uniqueNumber !== m.uniqueNumber ||
        other.fullName !== m.fullName
      )
        throw new Error(
          'This member’s accounts changed. Select the member again.',
        );
      for (const type of TYPES)
        if (
          values[type] > 0 &&
          !['fixed', 'saving'].includes(details.accountTypes?.[type] ?? '')
        )
          throw new Error('Select an account type for each amount.');
    }
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
          ...(details.otherAccountId
            ? { accountType: details.accountTypes![type] }
            : {}),
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
      accountNumberSnapshot: details.otherAccountId ? '' : m.accountNumber,
      ...(details.otherAccountId
        ? { accountSelection: 'type', otherAccountId: details.otherAccountId }
        : {}),
      ...(note ? { note } : {}),
      ...(m.uniqueNumber ? { uniqueNumberSnapshot: m.uniqueNumber } : {}),
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
  const snap = await getDocFromServer(doc(db(), 'entries', id));
  return snap.exists() ? (snap.data() as Entry) : null;
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
  actorName: string,
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
        actorName,
        at: serverTimestamp(),
        recorded,
      },
    });
  });
}

export async function saveNote(uid: string, id: string, body: string) {
  online();
  const text = body.trim();
  if (!text || text.length > 2000)
    throw new Error('Enter a note of up to 2,000 characters.');
  const ref = doc(db(), 'users', uid, 'notes', id);
  await runTransaction(db(), async (tx) => {
    const prior = await tx.get(ref);
    if (prior.exists()) {
      if (prior.data().body !== text)
        throw new Error(
          'This note was already saved. Refresh before adding another.',
        );
      return;
    }
    tx.set(ref, { noteId: id, body: text, createdAt: serverTimestamp() });
  });
}
