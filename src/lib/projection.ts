import { Timestamp } from 'firebase/firestore';
import { firstOccurrence } from '../../functions/src/schedule';
import {
  dayStart,
  newLines,
  totals,
  TYPES,
  type Command,
} from '../../functions/src/protocol';
export function project(
  records: Record<string, any>,
  c: Command,
  uid: string,
): Record<string, any> {
  const r = { ...records },
    d = c.data,
    time = Timestamp.fromMillis(c.capturedAt);
  const sp = `sessions/${d.sessionId}`,
    ep = `entries/${d.entryId}`;
  if (c.kind === 'session') {
    if (!r[sp])
      r[sp] = {
        sessionId: d.sessionId,
        agentId: uid,
        workday: d.workday,
        startsAt: Timestamp.fromMillis(dayStart(d.workday)),
        endsAt: Timestamp.fromMillis(dayStart(d.workday) + 86400000),
        openingCash: d.openingCash,
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalLoanInstalments: 0,
        expectedCash: d.openingCash,
        revision: 0,
        lastMutationId: '',
        createdAt: time,
      };
  } else if (c.kind === 'entry') {
    if (r[ep]) return r;
    const s = r[sp];
    if (!s) throw new Error('Start a session first.');
    const m = d.member,
      typed = !!d.otherAccountId;
    r[ep] = {
      entryId: d.entryId,
      sessionId: d.sessionId,
      workday: s.workday,
      agentId: uid,
      agentNameSnapshot: d.agentName,
      memberId: m.memberId,
      memberNameSnapshot: m.fullName,
      accountNumberSnapshot: typed ? '' : m.accountNumber,
      ...(m.uniqueNumber ? { uniqueNumberSnapshot: m.uniqueNumber } : {}),
      ...(typed
        ? { accountSelection: 'type', otherAccountId: d.otherAccountId }
        : {}),
      note: d.note,
      createdAt: time,
      capturedAt: time,
      financialRevision: s.revision + 1,
      lines: newLines(d.values, d.accountTypes, typed),
    };
    r[sp] = {
      ...s,
      ...totals(s, d.values),
      revision: s.revision + 1,
      lastMutationId: d.entryId,
    };
  } else if (c.kind === 'void' || c.kind === 'record') {
    const e = r[ep],
      l = e?.lines[d.type];
    if (!l) throw new Error('This line is unavailable offline.');
    const line =
      c.kind === 'void'
        ? {
            ...l,
            state: 'voided',
            voidedBy: uid,
            voidedAt: time,
            voidReason: d.reason,
          }
        : {
            ...l,
            recorded: d.recorded,
            recordingRevision:
              l.recordingRevision + (l.recorded !== d.recorded ? 1 : 0),
          };
    r[ep] = { ...e, lines: { ...e.lines, [d.type]: line } };
    if (c.kind === 'void' && l.state === 'active')
      r[sp] = {
        ...r[sp],
        ...totals(
          r[sp],
          Object.fromEntries(
            TYPES.map((t) => [t, t === d.type ? l.amount : 0]),
          ),
          -1,
        ),
      };
  } else if (c.kind === 'note') {
    const path = `users/${uid}/notes/${d.noteId}`,
      old = r[path];
    if (d.action === 'delete') delete r[path];
    else if (d.action === 'save') {
      const scheduleChanged =
        !old ||
        JSON.stringify(old.reminder ?? { kind: 'none' }) !==
          JSON.stringify(d.reminder);
      r[path] = {
        ...old,
        noteId: d.noteId,
        body: d.body,
        tags: d.tags,
        reminder: d.reminder,
        done: old?.done ?? false,
        revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? time,
        ...(scheduleChanged
          ? {
              done: false,
              occurrenceAt:
                d.reminder.kind === 'once' && d.reminder.at <= c.capturedAt
                  ? null
                  : firstOccurrence(d.reminder, c.capturedAt),
            }
          : {}),
      };
    } else if (old)
      r[path] = { ...old, done: d.done, revision: (old.revision ?? 0) + 1 };
  }
  return r;
}
export function visible(
  records: Record<string, any>,
  pending: { command: Command; state: string }[],
  uid: string,
) {
  let r = records;
  const blocked = new Set(
    pending.filter((p) => p.state === 'attention').map((p) => p.command.scope),
  );
  for (const p of pending)
    if (!blocked.has(p.command.scope) && p.state !== 'attention') {
      try {
        r = project(r, p.command, uid);
      } catch {
        /* The queue exposes a blocked dependency. */
      }
    }
  return r;
}
