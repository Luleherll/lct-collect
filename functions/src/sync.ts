import { createHash } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  dayAt,
  dayStart,
  integer,
  MAX_TOTAL,
  newLines,
  totals,
  TYPES,
  type Command,
  type Outcome,
} from './protocol.js';
export function wire(value: any): any {
  if (value instanceof Timestamp) return { __timestamp: value.toMillis() };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, wire(v)]),
    );
  return value;
}
export const signature = (value: unknown): string => {
  const stable = (v: any): any =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
};
function fail(text: string): never {
  throw new HttpsError('failed-precondition', text);
}
export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
export function validateCommand(c: Command) {
  if (
    !c ||
    c.version !== 1 ||
    (c.actorId !== undefined &&
      (typeof c.actorId !== 'string' ||
        !c.actorId.length ||
        c.actorId.length > 128)) ||
    !validId(c.id) ||
    !validId(c.deviceId) ||
    (c.supersedes !== undefined && !validId(c.supersedes)) ||
    !integer(c.sequence, MAX_TOTAL) ||
    !integer(c.capturedAt, Number.MAX_SAFE_INTEGER) ||
    !c.data ||
    typeof c.data !== 'object' ||
    Array.isArray(c.data) ||
    typeof c.scope !== 'string' ||
    c.scope.length > 220 ||
    (c.dependsOn !== null && !validId(c.dependsOn)) ||
    !['session', 'entry', 'void', 'record', 'note'].includes(c.kind)
  )
    throw new HttpsError(
      'invalid-argument',
      'Unsupported or invalid operation. Update the app.',
    );
  if (JSON.stringify(c).length > 30000)
    throw new HttpsError('invalid-argument', 'Operation too large.');
}
async function financialTransaction(uid: string, c: Command): Promise<Outcome> {
  validateCommand(c);
  if (c.actorId !== undefined && c.actorId !== uid)
    throw new HttpsError(
      'permission-denied',
      'This operation belongs to another signed-in account.',
    );
  const db = getFirestore(),
    receipt = db.doc(`users/${uid}/mutations/${c.id}`),
    hash = signature(c);
  return db.runTransaction(async (tx) => {
    const [profileSnap, prior] = await Promise.all([
      tx.get(db.doc(`users/${uid}`)),
      tx.get(receipt),
    ]);
    const profile = profileSnap.data();
    if (
      !profile?.active ||
      profile.role !== (c.kind === 'record' ? 'viewer' : 'agent')
    )
      throw new HttpsError(
        'permission-denied',
        'Your account cannot perform this operation.',
      );
    if (prior.exists) {
      if (prior.data()!.hash !== hash)
        fail('This submission reference belongs to different data.');
      return prior.data()!.outcome as Outcome;
    }
    let predecessor: any;
    if (c.dependsOn) {
      const dep = await tx.get(db.doc(`users/${uid}/mutations/${c.dependsOn}`));
      if (
        !dep.exists ||
        dep.data()!.scope !== c.scope ||
        dep.data()!.outcome.status === 'rejected'
      )
        fail('A preceding operation needs attention.');
      predecessor = dep.data()!.outcome;
    }
    const d = c.data,
      now = Timestamp.now(),
      records: Record<string, any> = {};
    let revision: number | undefined;
    const id = (v: unknown) => {
      if (
        typeof v !== 'string' ||
        !v.length ||
        v.length > 100 ||
        v.includes('/')
      )
        fail('Invalid record reference.');
      return v as string;
    };
    const sessionId = c.kind === 'record' ? '' : id(d.sessionId);
    const entryId = c.kind === 'session' ? '' : id(d.entryId);
    if (
      c.scope !==
      (c.kind === 'record'
        ? `record:${entryId}:${d.type}`
        : `session:${sessionId}`)
    )
      fail('Invalid operation scope.');
    const sessionRef = sessionId ? db.doc(`sessions/${sessionId}`) : null;
    const entryRef = entryId ? db.doc(`entries/${entryId}`) : null;
    const s = sessionRef ? (await tx.get(sessionRef)).data() : undefined;
    const e = entryRef ? (await tx.get(entryRef)).data() : undefined;
    if (s && !integer(s.revision + 1, MAX_TOTAL))
      fail('Session revision limit reached. Contact the office.');
    if (c.kind === 'session') {
      const start = dayStart(d.workday);
      if (
        dayAt(c.capturedAt) !== d.workday ||
        sessionId !== `${uid}_${d.workday}` ||
        !integer(d.openingCash)
      )
        fail('Invalid opening cash or workday.');
      if (start > now.toMillis())
        fail('Device date is ahead. Correct it before syncing.');
      if (s && s.openingCash !== d.openingCash)
        fail(
          'Opening cash differs from the existing session. Contact the office.',
        );
      const next = s ?? {
        sessionId,
        agentId: uid,
        workday: d.workday,
        startsAt: Timestamp.fromMillis(start),
        endsAt: Timestamp.fromMillis(start + 86400000),
        openingCash: d.openingCash,
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalLoanInstalments: 0,
        expectedCash: d.openingCash,
        revision: 0,
        lastMutationId: '',
        createdAt: now,
      };
      if (!s) tx.create(sessionRef!, next);
      records[sessionRef!.path] = next;
      revision = next.revision;
    } else if (c.kind === 'entry') {
      if (!s || s.agentId !== uid || sessionId !== `${uid}_${s.workday}`)
        fail('Start a session first.');
      if (e) fail('This entry reference already exists. Check recent entries.');
      if (!validId(entryId) || dayAt(c.capturedAt) !== s.workday)
        fail('The entry does not belong to this workday.');
      const values = d.values;
      if (
        !values ||
        !TYPES.every((t) => integer(values[t])) ||
        !TYPES.some((t) => values[t] > 0) ||
        Object.keys(values).some((t) => !TYPES.includes(t as any))
      )
        fail('Check the whole UGX amounts.');
      if (!d.member || typeof d.member !== 'object')
        fail('Select an account first.');
      const m = (
        await tx.get(db.doc(`members/${id(d.member.memberId)}`))
      ).data();
      if (
        !m?.active ||
        m.memberId !== d.member.memberId ||
        ['fullName', 'accountNumber', 'uniqueNumber'].some(
          (k) => (m[k] ?? '') !== (d.member[k] ?? ''),
        )
      )
        fail('This account changed. Select it again.');
      const typed = !!d.otherAccountId;
      if (typed) {
        const other = (
          await tx.get(db.doc(`members/${id(d.otherAccountId)}`))
        ).data();
        if (
          !other?.active ||
          other.memberId === m.memberId ||
          !m.uniqueNumber ||
          other.uniqueNumber !== m.uniqueNumber ||
          other.fullName !== m.fullName ||
          TYPES.some(
            (t) =>
              t !== 'loanInstalment' &&
              values[t] > 0 &&
              !['fixed', 'saving'].includes(d.accountTypes?.[t]),
          )
        )
          fail('Member accounts or account types changed. Review this entry.');
      }
      if (typeof d.note !== 'string' || d.note.trim().length > 2000)
        fail('Keep notes within 2,000 characters.');
      revision = s.revision + 1;
      const late = now.toMillis() >= s.endsAt.toMillis();
      const next = {
        entryId,
        sessionId,
        workday: s.workday,
        agentId: uid,
        agentNameSnapshot: profile.displayName,
        memberId: m.memberId,
        accountNumberSnapshot: typed ? '' : m.accountNumber,
        memberNameSnapshot: m.fullName,
        ...(m.uniqueNumber ? { uniqueNumberSnapshot: m.uniqueNumber } : {}),
        ...(typed
          ? { accountSelection: 'type', otherAccountId: d.otherAccountId }
          : {}),
        ...(d.note.trim() ? { note: d.note.trim() } : {}),
        createdAt: now,
        capturedAt: Timestamp.fromMillis(c.capturedAt),
        receivedAt: now,
        lateSubmission: late,
        clockFlag: c.capturedAt > now.toMillis() + 300000,
        financialRevision: revision,
        lines: newLines(values, d.accountTypes, typed),
      };
      const nextSession = {
        ...s,
        ...totals(s, values),
        revision,
        lastMutationId: entryId,
      };
      tx.create(entryRef!, next);
      tx.set(sessionRef!, nextSession);
      records[entryRef!.path] = next;
      records[sessionRef!.path] = nextSession;
    } else {
      if (!e || !TYPES.includes(d.type)) fail('This line is unavailable.');
      const l = e.lines[d.type];
      if (!l || l.state !== 'active')
        fail('Voided or missing lines cannot be changed.');
      const next: Record<string, any> = { ...e, lines: { ...e.lines } };
      if (c.kind === 'void') {
        if (
          !s ||
          s.agentId !== uid ||
          e.agentId !== uid ||
          e.sessionId !== sessionId ||
          now.toMillis() < s.startsAt.toMillis() ||
          now.toMillis() >= s.endsAt.toMillis() ||
          l.recorded
        )
          fail('Only your current, active, unrecorded lines can be voided.');
        if (
          typeof d.reason !== 'string' ||
          d.reason.trim().length < 3 ||
          d.reason.trim().length > 500
        )
          fail('Enter a reason of 3–500 characters.');
        next.lines[d.type] = {
          ...l,
          state: 'voided',
          voidedBy: uid,
          voidedAt: now,
          voidReason: d.reason.trim(),
        };
        revision = s.revision + 1;
        next.financialRevision = revision;
        const nextSession = {
          ...s,
          ...totals(
            s,
            Object.fromEntries(
              TYPES.map((t) => [t, t === d.type ? l.amount : 0]),
            ),
            -1,
          ),
          revision,
          lastMutationId: entryId,
        };
        tx.set(sessionRef!, nextSession);
        records[sessionRef!.path] = nextSession;
      } else if (c.kind === 'record') {
        const expected = predecessor?.revision ?? d.expectedRevision;
        if (!integer(expected, 40) || l.recordingRevision !== expected)
          fail('The recording status changed. Review it before retrying.');
        if (typeof d.recorded !== 'boolean') fail('Invalid recording status.');
        revision = l.recordingRevision;
        if (l.recorded !== d.recorded) {
          revision!++;
          if (revision! > 40) fail('Audit limit reached. Contact the owner.');
          next.lines[d.type] = {
            ...l,
            recorded: d.recorded,
            recordedBy: d.recorded ? uid : null,
            recordedAt: d.recorded ? now : null,
            recordingRevision: revision,
            recordingHistory: {
              ...l.recordingHistory,
              [revision!]: {
                by: uid,
                actorName: profile.displayName,
                at: now,
                recorded: d.recorded,
              },
            },
          };
        }
      } else fail('Unsupported operation.');
      tx.set(entryRef!, next);
      records[entryRef!.path] = next;
    }
    const outcome = {
      records: wire(records),
      ...(revision === undefined ? {} : { revision }),
    };
    tx.create(receipt, {
      hash,
      scope: c.scope,
      outcome,
      receivedAt: now,
      ...receiptMetadata(c),
    });
    return outcome;
  });
}

export async function financial(uid: string, c: Command): Promise<Outcome> {
  try {
    return await financialTransaction(uid, c);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e instanceof Error && /Withdrawal|workday|Invalid time/.test(e.message))
      throw new HttpsError('failed-precondition', e.message);
    throw e;
  }
}

/** A rejected operation has a durable terminal receipt too: its old ID can never post later. */
export async function recordRejection(
  uid: string,
  c: Command,
  error: HttpsError,
): Promise<Outcome> {
  const db = getFirestore(),
    ref = db.doc(`users/${uid}/mutations/${c.id}`),
    hash = signature(c);
  return db.runTransaction(async (tx) => {
    const prior = await tx.get(ref);
    if (prior.exists) {
      if (prior.data()!.hash !== hash)
        throw new HttpsError(
          'invalid-argument',
          'Submission reference reused.',
        );
      return prior.data()!.outcome;
    }
    const outcome: Outcome = {
      status: 'rejected',
      message: error.message,
      code: error.code,
      records: {},
    };
    tx.create(ref, {
      hash,
      scope: c.scope,
      outcome,
      receivedAt: Timestamp.now(),
      ...receiptMetadata(c),
    });
    return outcome;
  });
}

export function receiptMetadata(c: Command) {
  return {
    schemaVersion: c.version,
    claimedActorId: c.actorId ?? null,
    kind: c.kind,
    deviceId: c.deviceId,
    capturedAtMs: c.capturedAt,
    sequence: c.sequence,
    dependsOn: c.dependsOn,
    supersedes: c.supersedes ?? null,
  };
}
