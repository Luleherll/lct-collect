import { affectedPaths } from './command-state';
import {
  pack,
  releaseHeldRecords,
  type LocalState,
  type Pending,
  type Resolved,
} from './local';
import { project } from './projection';
import {
  dayAt,
  integer,
  TYPES,
  type Command,
} from '../../functions/src/protocol';

export interface ArchiveReview {
  id: string;
  token: string;
  releaseCount: number;
  blockedCount: number;
  blockedReason: string;
  expectedCash: number;
  workday: string;
}
export function rejectedVoidScope(s: LocalState, id: string, uid: string) {
  const head = s.commands.find((p) => p.command.id === id);
  if (
    !head ||
    head.state !== 'attention' ||
    head.command.kind !== 'void' ||
    s.receipts[id]?.status !== 'rejected'
  )
    throw new Error(
      'Only a confirmed rejected void can be archived. Retry uncertain delivery with its original reference first.',
    );
  const items = s.commands.filter(
    (p) => p.command.scope === head.command.scope,
  );
  if (items[0] !== head)
    throw new Error('Review the earlier change for this session first.');
  for (const [index, item] of items.entries()) {
    if (item.command.actorId && item.command.actorId !== uid)
      throw new Error('This change belongs to another account.');
    if (index && item.command.dependsOn !== items[index - 1].command.id)
      throw new Error(
        'The dependency chain changed. Export a recovery copy and contact the office.',
      );
  }
  return items;
}
export function archivePaths(items: Pending[], uid: string) {
  return [
    ...new Set(
      items.flatMap(({ command: c }) => [
        ...affectedPaths(c, uid),
        ...(c.kind === 'entry'
          ? [
              `members/${c.data.member?.memberId}`,
              ...(c.data.otherAccountId
                ? [`members/${c.data.otherAccountId}`]
                : []),
            ]
          : []),
      ]),
    ),
  ].sort();
}
function eligible(
  c: Command,
  records: Record<string, any>,
  uid: string,
  now: number,
) {
  const d = c.data,
    session = records[`sessions/${d.sessionId}`];
  if (
    !session ||
    session.agentId !== uid ||
    c.scope !== `session:${d.sessionId}` ||
    d.sessionId !== `${uid}_${session.workday}`
  )
    throw new Error('The session is unavailable. Contact the office.');
  if (c.kind === 'entry') {
    if (records[`entries/${d.entryId}`])
      throw new Error(
        'This entry reference already exists. Check recent entries before retrying.',
      );
    if (dayAt(c.capturedAt) !== session.workday)
      throw new Error('This entry belongs to another workday.');
    if (
      !d.values ||
      !TYPES.every((t) => integer(d.values[t])) ||
      !TYPES.some((t) => d.values[t] > 0) ||
      Object.keys(d.values).some((t) => !TYPES.includes(t as any))
    )
      throw new Error('Review the entry amounts before retrying.');
    const member = records[`members/${d.member?.memberId}`];
    if (
      !member?.active ||
      member.memberId !== d.member?.memberId ||
      ['fullName', 'accountNumber', 'uniqueNumber'].some(
        (k) => (member[k] ?? '') !== (d.member?.[k] ?? ''),
      )
    )
      throw new Error(
        'This account changed or is unavailable. Review the entry before retrying.',
      );
    if (d.otherAccountId) {
      const other = records[`members/${d.otherAccountId}`];
      if (
        !other?.active ||
        other.memberId === member.memberId ||
        !member.uniqueNumber ||
        other.uniqueNumber !== member.uniqueNumber ||
        other.fullName !== member.fullName ||
        TYPES.some(
          (t) =>
            t !== 'loanInstalment' &&
            d.values[t] > 0 &&
            !['fixed', 'saving'].includes(d.accountTypes?.[t]),
        )
      )
        throw new Error(
          'The member accounts or account types changed. Review this entry.',
        );
    }
    if (typeof d.note !== 'string' || d.note.trim().length > 2000)
      throw new Error('Review the entry note before retrying.');
  } else if (c.kind === 'void') {
    const entry = records[`entries/${d.entryId}`],
      line = entry?.lines?.[d.type];
    if (
      now < session.startsAt.toMillis() ||
      now >= session.endsAt.toMillis() ||
      entry?.agentId !== uid ||
      entry.sessionId !== d.sessionId ||
      !line ||
      line.state !== 'active' ||
      line.recorded
    )
      throw new Error(
        'This void is no longer eligible. Review it with the office.',
      );
    if (
      typeof d.reason !== 'string' ||
      d.reason.trim().length < 3 ||
      d.reason.trim().length > 500
    )
      throw new Error('Review the void reason before retrying.');
  } else throw new Error('This change requires a separate review.');
}
export function planVoidArchive(
  s: LocalState,
  id: string,
  uid: string,
  now = Date.now(),
): ArchiveReview {
  const items = rejectedVoidScope(s, id, uid);
  const session = s.records[`sessions/${items[0].command.data.sessionId}`];
  if (!session || session.agentId !== uid)
    throw new Error('Refresh the session before reviewing this archive.');
  let base = s.records,
    releaseCount = 0,
    blockedReason = '';
  for (const item of items.slice(1)) {
    if (blockedReason) break;
    if (
      item.state === 'attention' ||
      s.receipts[item.command.id]?.status === 'rejected'
    ) {
      blockedReason = item.error || 'A later change needs a separate review.';
      break;
    }
    try {
      eligible(item.command, base, uid, now);
      base = project(base, item.command, uid);
      releaseCount++;
    } catch (error) {
      blockedReason = (error as Error).message;
    }
  }
  const blockedCount = items.length - 1 - releaseCount;
  const token = JSON.stringify(
    pack({
      items,
      records: archivePaths(items, uid).map((path) => [
        path,
        s.records[path] ?? null,
      ]),
      releaseCount,
      blockedReason,
    }),
    (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
  );
  return {
    id,
    token,
    releaseCount,
    blockedCount,
    blockedReason,
    expectedCash: session.expectedCash,
    workday: session.workday,
  };
}
/** Never erase an uncertain operation or change a captured financial payload. */
export function applyVoidArchive(
  s: LocalState,
  review: ArchiveReview,
  uid: string,
  now = Date.now(),
  newId: () => string = () => crypto.randomUUID(),
) {
  const current = planVoidArchive(s, review.id, uid, now);
  if (current.token !== review.token)
    throw new Error(
      'Details changed. Review the archive and later changes again.',
    );
  const items = rejectedVoidScope(s, review.id, uid);
  const replacements = new Map<string, string>();
  const queued = items.slice(1).map((item, index): Pending => {
    const old = item.command,
      id = newId();
    replacements.set(old.id, id);
    return {
      command: {
        ...old,
        id,
        supersedes: old.id,
        sequence: ++s.sequence,
        dependsOn: index ? replacements.get(items[index].command.id)! : null,
      },
      state:
        index === review.releaseCount && review.blockedCount
          ? 'attention'
          : 'pending',
      error: index === review.releaseCount ? review.blockedReason : '',
      ...(index === review.releaseCount && review.blockedCount
        ? { requiresReview: true }
        : {}),
    };
  });
  s.resolved ??= [];
  s.resolved.push(
    ...items.map((item): Resolved => ({
      ...structuredClone(pack(item)),
      resolution: item.command.id === review.id ? 'archived' : 'replaced',
      resolvedAt: now,
      replacementId: replacements.get(item.command.id) ?? null,
    })),
  );
  const oldIds = new Set(items.map((item) => item.command.id));
  const byOldId = new Map(
    items.slice(1).map((item, index) => [item.command.id, queued[index]]),
  );
  s.commands = s.commands.flatMap((item) =>
    item.command.id === review.id
      ? []
      : oldIds.has(item.command.id)
        ? [byOldId.get(item.command.id)!]
        : [item],
  );
  releaseHeldRecords(s, uid);
}

export function requeueReviewed(
  s: LocalState,
  id: string,
  uid: string,
  reviewedData?: Record<string, any>,
  newId: () => string = () => crypto.randomUUID(),
) {
  const head = s.commands.find((p) => p.command.id === id);
  if (!head || head.state !== 'attention')
    throw new Error('This change is no longer waiting for review.');
  const items = s.commands.filter(
    (p) => p.command.scope === head.command.scope,
  );
  if (items[0] !== head)
    throw new Error(
      'Wait for the earlier change in this session before reviewing this one.',
    );
  if (s.receipts[id]?.status !== 'rejected' && !head.requiresReview)
    throw new Error(
      'Retry uncertain delivery with its original reference first.',
    );
  for (const [index, item] of items.entries()) {
    if (item.command.actorId && item.command.actorId !== uid)
      throw new Error('This change belongs to another account.');
    if (index && item.command.dependsOn !== items[index - 1].command.id)
      throw new Error('The dependency chain changed. Refresh the review.');
  }
  const replacements = new Map<string, string>();
  for (const pending of items) {
    const old = pending.command,
      nextId = newId();
    const data = {
      ...(old.id === id && reviewedData ? reviewedData : old.data),
    };
    if (old.actorId && old.actorId !== uid)
      throw new Error('This change belongs to another account.');
    if (old.kind === 'record')
      data.expectedRevision =
        s.records[`entries/${data.entryId}`]?.lines[data.type]
          ?.recordingRevision ?? 0;
    if (old.kind === 'note') {
      data.expectedRevision =
        s.records[`users/${uid}/notes/${data.noteId}`]?.revision ?? 0;
      data.occurrenceAt =
        s.records[`users/${uid}/notes/${data.noteId}`]?.occurrenceAt ?? null;
      data.mutationId = nextId;
    }
    s.resolved ??= [];
    s.resolved.push(
      structuredClone(
        pack({
          ...pending,
          resolution: 'replaced',
          resolvedAt: Date.now(),
          replacementId: nextId,
        }),
      ),
    );
    pending.command = {
      ...old,
      id: nextId,
      supersedes: old.id,
      sequence: ++s.sequence,
      dependsOn:
        old.id === id ? null : (replacements.get(old.dependsOn ?? '') ?? null),
      data,
    };
    replacements.set(old.id, nextId);
    pending.state = 'pending';
    pending.error = '';
    delete pending.requiresReview;
  }
  releaseHeldRecords(s, uid);
}
