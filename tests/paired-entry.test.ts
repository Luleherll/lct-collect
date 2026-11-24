import {
  planVoidArchive,
  applyVoidArchive,
  requeueReviewed,
} from '../src/lib/queue-review';
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  entryParts,
  dayAt,
  dayStart,
  type Command,
} from '../functions/src/protocol';
import { project, visible } from '../src/lib/projection';
import { affectedPaths } from '../src/lib/command-state';
import {
  openLocal,
  changeLocal,
  clearLocal,
  localState,
  acknowledge,
  mergeServerRecords,
} from '../src/lib/local';
const data = () => ({
  entryId: 'paired-saving',
  fixedEntryId: 'paired-fixed',
  sessionId: 'pair-session',
  otherAccountId: 'other-member',
  member: {
    memberId: 'member-main',
    uniqueNumber: 'LCT007',
    fullName: 'Example',
    accountNumber: '0007',
  },
  agentName: 'Example Agent',
  note: 'Both accounts',
  values: { deposit: 1000, withdrawal: 1000, loanInstalment: 20 },
  splitAmounts: {
    deposit: { saving: 100, fixed: 900 },
    withdrawal: { saving: 800, fixed: 200 },
  },
  accountTypes: {},
});
const command = (): Command => ({
  version: 1,
  id: 'pair-command',
  kind: 'entryPair',
  data: data(),
  deviceId: 'pair-device',
  capturedAt: Date.now(),
  sequence: 1,
  dependsOn: null,
  scope: 'session:pair-session',
});
const base = () => ({
  'sessions/pair-session': {
    agentId: 'pair-agent',
    revision: 0,
    openingCash: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalLoanInstalments: 0,
    expectedCash: 0,
    workday: dayAt(Date.now()),
    createdAt: Timestamp.now(),
  },
});
it('expands four typed lines and counts the loan once; combined cash does not depend on account order', () => {
  const d = data(),
    parts = entryParts(d, true);
  expect(parts.map((p) => p.values)).toEqual([
    { deposit: 100, withdrawal: 800, loanInstalment: 20 },
    { deposit: 900, withdrawal: 200, loanInstalment: 0 },
  ]);
  const result = project(base(), command(), 'pair-agent');
  expect(result['sessions/pair-session'].expectedCash).toBe(20);
  expect(result['entries/paired-saving'].lines.deposit.accountType).toBe(
    'saving',
  );
  expect(result['entries/paired-fixed'].lines.withdrawal.accountType).toBe(
    'fixed',
  );
  expect(project(result, command(), 'pair-agent')).toEqual(result);
  const original = base();
  expect(
    visible(
      original,
      [{ command: command(), state: 'attention' }],
      'pair-agent',
    ),
  ).toEqual(original);
});
it('allocates single-mode amounts to the selected account beside a split transaction', () => {
  const d: any = data();
  delete d.splitAmounts.withdrawal;
  d.accountTypes.withdrawal = 'fixed';
  expect(entryParts(d, true).map((p) => p.values.withdrawal)).toEqual([
    0, 1000,
  ]);
});
it('rejects malformed, zero, mismatching and oversized paired amounts and invalid identities', () => {
  const patches: any[] = [
    { otherAccountId: '' },
    { fixedEntryId: 'paired-saving' },
    { fixedEntryId: '../bad' },
    { splitAmounts: {} },
    { splitAmounts: { deposit: { saving: 0, fixed: 1000 } } },
    { splitAmounts: { deposit: { saving: 100, fixed: 800 } } },
    { splitAmounts: { loanInstalment: { saving: 10, fixed: 10 } } },
    { values: { deposit: 100000001, withdrawal: 1000, loanInstalment: 20 } },
  ];
  for (const patch of patches)
    expect(() => entryParts({ ...data(), ...patch }, true)).toThrow();
  expect(() => entryParts(data(), false)).toThrow('Unsupported split');
});
it('persists one paired command, holds snapshots for both paths and acknowledges both atomically', async () => {
  await openLocal('pair-agent', 'demo-pair');
  await changeLocal((s) => {
    s.commands = [];
  });
  await clearLocal();
  await openLocal('pair-agent', 'demo-pair');
  const c = command();
  await changeLocal((s) => {
    s.records = base();
    s.commands.push({ command: c, state: 'pending', error: '' });
  });
  await openLocal('pair-agent', 'demo-pair');
  expect(localState().commands).toHaveLength(1);
  expect(affectedPaths(c, 'pair-agent')).toEqual([
    'sessions/pair-session',
    'entries/paired-saving',
    'entries/paired-fixed',
  ]);
  const records = project(base(), c, 'pair-agent');
  await changeLocal((s) => mergeServerRecords(s, records, 'pair-agent'));
  expect(localState().records['entries/paired-fixed']).toBeUndefined();
  await changeLocal((s) =>
    acknowledge(s, c.id, { records, revision: 1 }, 'pair-agent'),
  );
  expect(localState().commands).toHaveLength(0);
  expect(
    localState().records['entries/paired-saving'].lines.deposit.amount,
  ).toBe(100);
  expect(
    localState().records['entries/paired-fixed'].lines.deposit.amount,
  ).toBe(900);
});

it('reviewed void recovery safely releases a paired descendant with both captured amounts intact', () => {
  const uid = 'pair-agent',
    day = dayAt(Date.now()),
    sid = `${uid}_${day}`,
    c = command();
  c.data.sessionId = sid;
  c.scope = `session:${sid}`;
  c.dependsOn = 'rejected-void';
  const root: Command = {
    ...c,
    id: 'rejected-void',
    kind: 'void',
    dependsOn: null,
    data: {
      entryId: 'original-entry',
      sessionId: sid,
      type: 'deposit',
      reason: 'Old void',
    },
  };
  const member = { ...data().member, active: true };
  const s: any = {
    records: {
      [`sessions/${sid}`]: {
        ...base()['sessions/pair-session'],
        sessionId: sid,
        startsAt: Timestamp.fromMillis(dayStart(day)),
        endsAt: Timestamp.fromMillis(dayStart(day) + 86400000),
      },
      'members/member-main': member,
      'members/other-member': {
        ...member,
        memberId: 'other-member',
        accountNumber: '0008',
      },
    },
    commands: [
      { command: root, state: 'attention', error: 'Rejected' },
      { command: c, state: 'pending', error: '' },
    ],
    receipts: { 'rejected-void': { status: 'rejected', records: {} } },
    scopes: {},
    sequence: 2,
  };
  const review = planVoidArchive(s, root.id, uid);
  expect(review.blockedReason).toBe('');
  expect(review.releaseCount).toBe(1);
  const original = structuredClone(c.data);
  applyVoidArchive(s, review, uid);
  expect(s.commands).toHaveLength(1);
  expect(s.commands[0].state).toBe('pending');
  expect(s.commands[0].command.data).toEqual(original);
  expect(s.commands[0].command.kind).toBe('entryPair');
});
it('reviewed paired rejection keeps immutable original data in recovery history', () => {
  const c = command(),
    original = structuredClone(c);
  const s: any = {
    records: base(),
    commands: [{ command: c, state: 'attention', error: 'Rejected' }],
    receipts: { [c.id]: { status: 'rejected', records: {} } },
    scopes: {},
    sequence: 1,
  };
  requeueReviewed(s, c.id, 'pair-agent', c.data, () => 'replacement-command');
  expect(s.resolved[0].command).toEqual(original);
  expect(s.commands[0].command.data).toEqual(original.data);
  expect(s.commands[0].command.supersedes).toBe(original.id);
});
