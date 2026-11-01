import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  mergeServerScope,
  changeLocal,
  clearLocal,
  localState,
  openLocal,
  pack,
  reconcile,
  unpack,
} from '../src/lib/local';
import { project, visible } from '../src/lib/projection';
import {
  dayAt,
  dayStart,
  totals,
  type Command,
} from '../functions/src/protocol';
const uid = 'agent-local';
const day = dayAt(Date.now()),
  sessionId = `${uid}_${day}`;
const command = (
  kind: Command['kind'],
  data: Record<string, any>,
  sequence = 1,
): Command => ({
  version: 1,
  id: `command-${sequence}`,
  deviceId: 'device-test',
  sequence,
  capturedAt: Date.now(),
  scope: `session:${sessionId}`,
  dependsOn: null,
  kind,
  data,
});
const start = command('session', { sessionId, workday: day, openingCash: 100 });
const entry = command(
  'entry',
  {
    entryId: 'entry-test',
    sessionId,
    member: { memberId: '001', fullName: 'Example', accountNumber: '001' },
    values: { deposit: 50, withdrawal: 0, loanInstalment: 0 },
    note: '',
    accountTypes: {},
  },
  2,
);
describe('durable local-first operations', () => {
  beforeEach(async () => {
    await openLocal(uid, 'demo-local');
    await changeLocal((s) => {
      s.commands = [];
    });
    await clearLocal();
    await openLocal(uid, 'demo-local');
  });
  it('round-trips timestamps without losing methods', () => {
    expect(unpack(pack({ at: Timestamp.fromMillis(1234) })).at.toMillis()).toBe(
      1234,
    );
  });
  it('survives reopening and isolates users and projects', async () => {
    await changeLocal((s) => {
      s.commands.push({ command: start, state: 'pending', error: '' });
    });
    await openLocal(uid, 'demo-local');
    expect(localState().commands).toHaveLength(1);
    await openLocal('other', 'demo-local');
    expect(localState().commands).toHaveLength(0);
    await openLocal(uid, 'another-project');
    expect(localState().commands).toHaveLength(0);
  });
  it('serializes concurrent local mutations without losing either', async () => {
    await Promise.all([
      changeLocal((s) => {
        s.sequence++;
      }),
      changeLocal((s) => {
        s.sequence++;
      }),
    ]);
    expect(localState().sequence).toBe(2);
  });
  it('rolls back failed acceptance without reporting a queued command', async () => {
    await expect(
      changeLocal((s) => {
        s.sequence = 10;
        throw new Error('invalid');
      }),
    ).rejects.toThrow('invalid');
    expect(localState().sequence).toBe(0);
  });
  it('projects entries exactly once across live and receipt acknowledgement', () => {
    const base = project({}, start, uid),
      pending = [{ command: entry, state: 'pending' }];
    const projected = visible(base, pending, uid);
    expect(projected[`sessions/${sessionId}`].expectedCash).toBe(150);
    expect(
      visible(projected, pending, uid)[`sessions/${sessionId}`].expectedCash,
    ).toBe(150);
  });
  it('retains rejected commands but excludes their provisional financial effect', () => {
    const base = project({}, start, uid);
    expect(
      visible(base, [{ command: entry, state: 'attention' }], uid)[
        `sessions/${sessionId}`
      ].expectedCash,
    ).toBe(100);
  });
  it('does not roll back a newer server session with an older receipt', () => {
    const s = localState();
    s.records['sessions/test'] = { revision: 4, expectedCash: 200 };
    reconcile(s, { 'sessions/test': { revision: 2, expectedCash: 100 } });
    expect(s.records['sessions/test'].expectedCash).toBe(200);
  });
  it('rejects overspending and derives Uganda cutoff consistently', () => {
    expect(() =>
      totals(
        {
          openingCash: 100,
          totalDeposits: 0,
          totalWithdrawals: 0,
          totalLoanInstalments: 0,
        },
        { deposit: 0, withdrawal: 101, loanInstalment: 0 },
      ),
    ).toThrow();
    expect(dayAt(dayStart('2026-11-01'))).toBe('2026-11-01');
    expect(dayAt(dayStart('2026-11-01') - 1)).toBe('2026-10-31');
  });
  it('holds non-atomic live snapshots until a receipt can reconcile totals and entry together', async () => {
    await changeLocal((s) => {
      s.records = project({}, start, uid);
      s.commands = [{ command: entry, state: 'pending', error: '' }];
    });
    const confirmed = visible(localState().records, localState().commands, uid);
    await changeLocal((s) => {
      mergeServerScope(
        s,
        'session-live',
        { [`sessions/${sessionId}`]: confirmed[`sessions/${sessionId}`] },
        uid,
      );
    });
    expect(
      visible(localState().records, localState().commands, uid)[
        `sessions/${sessionId}`
      ].expectedCash,
    ).toBe(150);
    await changeLocal((s) => {
      reconcile(s, confirmed);
      s.commands = [];
    });
    expect(localState().records[`sessions/${sessionId}`].expectedCash).toBe(
      150,
    );
    expect(
      Object.keys(localState().records).filter((k) => k.startsWith('entries/')),
    ).toHaveLength(1);
  });
  it('refuses destructive cache clearing while unsynced work exists', async () => {
    await changeLocal((s) => {
      s.commands = [{ command: start, state: 'pending', error: '' }];
    });
    await expect(clearLocal()).rejects.toThrow('Unsynced');
    expect(localState().commands).toHaveLength(1);
  });
});
