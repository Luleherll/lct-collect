import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  planVoidArchive,
  applyVoidArchive,
  requeueReviewed,
} from '../src/lib/queue-review';
import { visible } from '../src/lib/projection';
import { type LocalState, pack } from '../src/lib/local';
import { dayStart, newLines, type Command } from '../functions/src/protocol';
const uid = 'agent-review',
  day = '2026-10-01',
  sessionId = `${uid}_${day}`,
  scope = `session:${sessionId}`,
  capturedAt = dayStart(day) + 43200000,
  now = capturedAt + 172800000;
const command = (
  id: string,
  kind: Command['kind'],
  data: Record<string, any>,
  dependsOn: string | null = null,
): Command => ({
  id,
  kind,
  data,
  scope,
  dependsOn,
  capturedAt,
  actorId: uid,
  deviceId: 'test-device',
  sequence: 1,
  version: 1,
});
function state(): LocalState {
  const member = {
    memberId: 'member-a',
    fullName: 'Member A',
    uniqueNumber: 'LCT001',
    accountNumber: '00001',
    active: true,
  };
  const root = command('rejected-void', 'void', {
    sessionId,
    entryId: 'original-entry',
    type: 'deposit',
    reason: 'Incorrect deposit',
  });
  const a = command(
    'entry-a',
    'entry',
    {
      sessionId,
      entryId: 'entry-a',
      member,
      values: { deposit: 25, withdrawal: 0, loanInstalment: 0 },
      note: 'Captured offline',
      accountTypes: {},
    },
    root.id,
  );
  const b = command(
    'entry-b',
    'entry',
    {
      ...a.data,
      entryId: 'entry-b',
      values: { deposit: 10, withdrawal: 0, loanInstalment: 0 },
    },
    a.id,
  );
  return {
    records: {
      [`sessions/${sessionId}`]: {
        sessionId,
        agentId: uid,
        workday: day,
        startsAt: Timestamp.fromMillis(dayStart(day)),
        endsAt: Timestamp.fromMillis(dayStart(day) + 86400000),
        openingCash: 100,
        totalDeposits: 50,
        totalWithdrawals: 0,
        totalLoanInstalments: 0,
        expectedCash: 150,
        revision: 1,
      },
      'entries/original-entry': {
        entryId: 'original-entry',
        sessionId,
        agentId: uid,
        financialRevision: 1,
        lines: newLines({ deposit: 50, withdrawal: 0, loanInstalment: 0 }),
      },
      'members/member-a': member,
    },
    commands: [
      { command: root, state: 'attention', error: 'Session ended' },
      { command: a, state: 'pending', error: '' },
      { command: b, state: 'pending', error: '' },
    ],
    receipts: {
      [root.id]: { status: 'rejected', records: {}, message: 'Session ended' },
    },
    scopes: {},
    sequence: 3,
  };
}
const ids = () => {
  let i = 0;
  return () => `reviewed-${++i}`;
};
describe('reviewed archive of a terminal void rejection', () => {
  it('archives the expired void and releases later deposits under their original workday and entry IDs', () => {
    const s = state(),
      original = pack(s.commands),
      review = planVoidArchive(s, 'rejected-void', uid, now);
    expect(review).toMatchObject({
      releaseCount: 2,
      blockedCount: 0,
      expectedCash: 150,
      workday: day,
    });
    applyVoidArchive(s, review, uid, now, ids());
    expect(s.commands.map((p) => p.command.kind)).toEqual(['entry', 'entry']);
    expect(s.commands.map((p) => p.command.dependsOn)).toEqual([
      null,
      'reviewed-1',
    ]);
    expect(s.commands.map((p) => p.command.supersedes)).toEqual([
      'entry-a',
      'entry-b',
    ]);
    expect(s.commands.map((p) => p.command.capturedAt)).toEqual([
      capturedAt,
      capturedAt,
    ]);
    expect(pack(s.commands[0].command.data)).toEqual(original[1].command.data);
    expect(s.commands[0].command.data.entryId).toBe('entry-a');
    expect(s.resolved?.[0]).toMatchObject({
      command: original[0].command,
      state: 'attention',
      error: 'Session ended',
      resolution: 'archived',
    });
    expect(s.receipts['rejected-void'].status).toBe('rejected');
    expect(s.records['entries/original-entry'].lines.deposit.state).toBe(
      'active',
    );
    expect(
      visible(s.records, s.commands, uid)[`sessions/${sessionId}`].expectedCash,
    ).toBe(185);
    expect(() => applyVoidArchive(s, review, uid, now, ids())).toThrow();
  });
  it('refuses to archive uncertain delivery or another actor and leaves all payloads intact', () => {
    for (const alteration of [
      (s: LocalState) => {
        delete s.receipts['rejected-void'];
      },
      (s: LocalState) => {
        s.commands[0].command.actorId = 'another-user';
      },
    ]) {
      const s = state();
      alteration(s);
      const original = pack(s);
      expect(() => planVoidArchive(s, 'rejected-void', uid, now)).toThrow();
      expect(pack(s)).toEqual(original);
    }
  });
  it('does not detach a queue with an unverified dependency chain', () => {
    const s = state();
    s.commands[1].command.dependsOn = null;
    expect(() => planVoidArchive(s, 'rejected-void', uid, now)).toThrow(
      'dependency chain',
    );
    expect(() => requeueReviewed(s, 'rejected-void', uid)).toThrow(
      'dependency chain',
    );
  });
  it('requires renewed review if balances or queued work change before confirmation', () => {
    for (const alteration of [
      (s: LocalState) => {
        s.records[`sessions/${sessionId}`].expectedCash++;
      },
      (s: LocalState) => {
        s.commands[1].command.data.values.deposit++;
      },
    ]) {
      const s = state(),
        review = planVoidArchive(s, 'rejected-void', uid, now);
      alteration(s);
      const original = pack(s);
      expect(() => applyVoidArchive(s, review, uid, now, ids())).toThrow(
        'Details changed',
      );
      expect(pack(s)).toEqual(original);
    }
  });
  it('keeps unsafe descendants for review instead of retrying against money restored by the rejected void', () => {
    const s = state(),
      session = s.records[`sessions/${sessionId}`];
    session.openingCash = 150;
    session.totalDeposits = 0;
    session.totalWithdrawals = 50;
    session.expectedCash = 100;
    s.records['entries/original-entry'].lines = newLines({
      deposit: 0,
      withdrawal: 50,
      loanInstalment: 0,
    });
    s.commands[0].command.data.type = 'withdrawal';
    s.commands[1].command.data.values = {
      deposit: 0,
      withdrawal: 120,
      loanInstalment: 0,
    };
    const review = planVoidArchive(s, 'rejected-void', uid, now);
    expect(review).toMatchObject({ releaseCount: 0, blockedCount: 2 });
    applyVoidArchive(s, review, uid, now, ids());
    expect(s.commands[0]).toMatchObject({
      state: 'attention',
      requiresReview: true,
    });
    expect(
      visible(s.records, s.commands, uid)[`sessions/${sessionId}`].expectedCash,
    ).toBe(100);
    const corrected = {
      ...s.commands[0].command.data,
      values: { deposit: 0, withdrawal: 80, loanInstalment: 0 },
    };
    const retiredId = s.commands[0].command.id;
    let replacement = 100;
    requeueReviewed(
      s,
      retiredId,
      uid,
      corrected,
      () => `corrected-${++replacement}`,
    );
    expect(s.commands[0].command.id).not.toBe(retiredId);
    expect(s.commands[0].requiresReview).toBeUndefined();
    expect(
      visible(s.records, s.commands, uid)[`sessions/${sessionId}`].expectedCash,
    ).toBe(30);
  });
  it('stops at changed member details and does not silently replace the captured identity', () => {
    const s = state();
    s.records['members/member-a'] = {
      ...s.records['members/member-a'],
      fullName: 'Changed name',
    };
    const review = planVoidArchive(s, 'rejected-void', uid, now);
    expect(review.releaseCount).toBe(0);
    expect(review.blockedReason).toContain('account changed');
    applyVoidArchive(s, review, uid, now, ids());
    expect(s.commands[0].command.data.member.fullName).toBe('Member A');
  });
  it('preserves unrelated scopes and prevents retrying a later command ahead of an earlier one', () => {
    const s = state(),
      other = {
        command: {
          ...s.commands[1].command,
          id: 'other',
          scope: 'session:another',
        },
        state: 'pending' as const,
        error: '',
      };
    s.commands.splice(1, 0, other);
    const review = planVoidArchive(s, 'rejected-void', uid, now);
    applyVoidArchive(s, review, uid, now, ids());
    expect(s.commands[0]).toBe(other);
    s.commands[2].state = 'attention';
    s.commands[2].requiresReview = true;
    expect(() => requeueReviewed(s, s.commands[2].command.id, uid)).toThrow(
      'earlier change',
    );
  });
});
