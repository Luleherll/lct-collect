import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { bounds, workday } from '../src/lib/domain';
import type { Entry, LineType, Session } from '../src/lib/models';

if (!process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error(
    'Rules tests require the isolated emulator. Use npm run test:rules.',
  );
let env: RulesTestEnvironment;
const day = workday(),
  sessionId = `agent-a_${day}`,
  times = bounds(day);
const member = {
  memberId: '137',
  accountNumber: '000401001137',
  uniqueNumber: 'LCT002',
  fullName: 'Example Member',
  searchName: 'example member',
  active: true,
  updatedAt: Timestamp.now(),
};
const baseSession = () => ({
  sessionId,
  agentId: 'agent-a',
  workday: day,
  startsAt: Timestamp.fromDate(times.start),
  endsAt: Timestamp.fromDate(times.end),
  openingCash: 100,
  totalDeposits: 0,
  totalWithdrawals: 0,
  totalLoanInstalments: 0,
  expectedCash: 100,
  revision: 0,
  lastMutationId: '',
  createdAt: Timestamp.now(),
});
const line = (n: number) => ({
  amount: n,
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
const agent = () =>
  env.authenticatedContext('agent-a').firestore() as unknown as Firestore;
const viewer = () =>
  env.authenticatedContext('viewer-a').firestore() as unknown as Firestore;
async function create(
  db: Firestore,
  id = 'entry_00000001',
  values: Partial<Record<LineType, number>> = { deposit: 20 },
  patch: Record<string, unknown> = {},
) {
  return runTransaction(db, async (tx) => {
    const targetSession = String(patch.sessionId ?? sessionId);
    const sRef = doc(db, 'sessions', targetSession),
      eRef = doc(db, 'entries', id);
    const [existing, snap] = await Promise.all([tx.get(eRef), tx.get(sRef)]);
    if (existing.exists()) return;
    const s = snap.data() as Session;
    const d = values.deposit ?? 0,
      w = values.withdrawal ?? 0,
      l = values.loanInstalment ?? 0;
    tx.set(eRef, {
      entryId: id,
      sessionId: targetSession,
      workday: s.workday,
      agentId: 'agent-a',
      agentNameSnapshot: 'Agent A',
      memberId: member.memberId,
      accountNumberSnapshot: member.accountNumber,
      memberNameSnapshot: member.fullName,
      createdAt: serverTimestamp(),
      financialRevision: s.revision + 1,
      lines: Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, line(v!)]),
      ),
      ...patch,
    });
    tx.update(sRef, {
      totalDeposits: s.totalDeposits + d,
      totalWithdrawals: s.totalWithdrawals + w,
      totalLoanInstalments: s.totalLoanInstalments + l,
      expectedCash: s.expectedCash + d + l - w,
      revision: s.revision + 1,
      lastMutationId: id,
    });
  });
}
async function voidLine(db: Firestore, kind: LineType = 'deposit') {
  return runTransaction(db, async (tx) => {
    const eRef = doc(db, 'entries', 'entry_00000001'),
      sRef = doc(db, 'sessions', sessionId);
    const [es, ss] = await Promise.all([tx.get(eRef), tx.get(sRef)]),
      e = es.data() as Entry,
      s = ss.data() as Session,
      n = e.lines[kind]!.amount;
    tx.update(eRef, {
      [`lines.${kind}.state`]: 'voided',
      [`lines.${kind}.voidedBy`]: 'agent-a',
      [`lines.${kind}.voidedAt`]: serverTimestamp(),
      [`lines.${kind}.voidReason`]: 'Wrong account selected',
      financialRevision: s.revision + 1,
    });
    tx.update(sRef, {
      totalDeposits: s.totalDeposits - (kind === 'deposit' ? n : 0),
      totalWithdrawals: s.totalWithdrawals - (kind === 'withdrawal' ? n : 0),
      totalLoanInstalments:
        s.totalLoanInstalments - (kind === 'loanInstalment' ? n : 0),
      expectedCash: s.expectedCash + (kind === 'withdrawal' ? n : -n),
      revision: s.revision + 1,
      lastMutationId: e.entryId,
    });
  });
}
async function record(
  db: Firestore,
  value = true,
  revision = 1,
  by = 'viewer-a',
  kind: LineType = 'deposit',
) {
  const key = `lines.${kind}`;
  return updateDoc(doc(db, 'entries', 'entry_00000001'), {
    [`${key}.recorded`]: value,
    [`${key}.recordedBy`]: value ? by : null,
    [`${key}.recordedAt`]: value ? serverTimestamp() : null,
    [`${key}.recordingRevision`]: revision,
    [`${key}.recordingHistory.${revision}`]: {
      by,
      at: serverTimestamp(),
      recorded: value,
    },
  });
}
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-lct-collect',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
}, 20000);
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    for (const [uid, role, active] of [
      ['agent-a', 'agent', true],
      ['agent-b', 'agent', true],
      ['viewer-a', 'viewer', true],
      ['admin-a', 'admin', true],
      ['inactive', 'agent', false],
    ] as const)
      await setDoc(doc(db, 'users', uid), {
        username: uid,
        displayName: uid === 'agent-a' ? 'Agent A' : uid,
        role,
        active,
        createdAt: Timestamp.now(),
      });
    await setDoc(doc(db, 'members', '137'), member);
    await setDoc(doc(db, 'accountNumbers', member.accountNumber), {
      memberId: member.memberId,
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'sessions', sessionId), baseSession());
  });
});
describe('financial write protocol', () => {
  it.each(['deposit', 'withdrawal', 'loanInstalment'] as const)(
    'accepts a single %s line and its eligible reversal',
    async (kind) => {
      const db = agent();
      await assertSucceeds(create(db, undefined, { [kind]: 20 }));
      await assertSucceeds(voidLine(db, kind));
      expect(
        (await getDoc(doc(db, 'sessions', sessionId))).data()?.expectedCash,
      ).toBe(100);
    },
  );
  it('creates a grouped entry atomically and retries without duplication', async () => {
    const db = agent();
    await assertSucceeds(
      create(db, undefined, { deposit: 20, withdrawal: 5, loanInstalment: 10 }),
    );
    await assertSucceeds(create(db));
    const s = (await getDoc(doc(db, 'sessions', sessionId))).data();
    expect(s?.expectedCash).toBe(125);
    expect(s?.revision).toBe(1);
  });
  it('does not accept a new entry without the aggregate update', async () => {
    const db = agent();
    await assertSucceeds(create(db));
    const e = (await getDoc(doc(db, 'entries', 'entry_00000001'))).data()!;
    await assertFails(
      setDoc(doc(db, 'entries', 'entry_00000002'), {
        ...e,
        entryId: 'entry_00000002',
        createdAt: serverTimestamp(),
        financialRevision: 2,
      }),
    );
  });
  it('rejects fabricated cash, aggregate changes and replayed aggregate deltas', async () => {
    const db = agent();
    await assertFails(
      updateDoc(doc(db, 'sessions', sessionId), {
        totalDeposits: 500,
        expectedCash: 600,
        revision: 1,
        lastMutationId: 'entry_00000001',
      }),
    );
    await create(db);
    await assertFails(
      updateDoc(doc(db, 'sessions', sessionId), {
        totalDeposits: 40,
        expectedCash: 140,
        revision: 2,
      }),
    );
  });
  it('rejects forged identities and directory snapshots', async () => {
    await assertFails(
      create(agent(), undefined, { deposit: 20 }, { agentId: 'agent-b' }),
    );
    await assertFails(
      create(
        agent(),
        undefined,
        { deposit: 20 },
        { memberNameSnapshot: 'Invented name' },
      ),
    );
    await assertFails(
      create(
        agent(),
        undefined,
        { deposit: 20 },
        { accountNumberSnapshot: '999' },
      ),
    );
  });
  it('rejects changed amounts, member identity and deletion', async () => {
    const db = agent();
    await create(db);
    const ref = doc(db, 'entries', 'entry_00000001');
    await assertFails(updateDoc(ref, { 'lines.deposit.amount': 500 }));
    await assertFails(updateDoc(ref, { memberId: '999' }));
    await assertFails(deleteDoc(ref));
    await assertFails(deleteDoc(doc(db, 'sessions', sessionId)));
  });
  it('reverses just one eligible line', async () => {
    const db = agent();
    await create(db, undefined, { deposit: 20, loanInstalment: 10 });
    await assertSucceeds(voidLine(db));
    const e = (await getDoc(doc(db, 'entries', 'entry_00000001'))).data()!;
    expect(e.lines.deposit.state).toBe('voided');
    expect(e.lines.loanInstalment.state).toBe('active');
    expect(
      (await getDoc(doc(db, 'sessions', sessionId))).data()?.expectedCash,
    ).toBe(110);
    await assertFails(voidLine(db));
  });
  it('denies recorded voids and voids that would make cash negative', async () => {
    let db = agent();
    await create(db);
    await record(viewer());
    await assertFails(voidLine(db));
    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(
        doc(c.firestore() as unknown as Firestore, 'entries', 'entry_00000001'),
        { 'lines.deposit.recorded': false },
      );
      await updateDoc(
        doc(c.firestore() as unknown as Firestore, 'sessions', sessionId),
        { openingCash: 0, totalWithdrawals: 20, expectedCash: 0 },
      );
    });
    await assertFails(voidLine(db));
  });
  it('prevents concurrent withdrawals exceeding physical cash', async () => {
    const db = agent();
    const results = await Promise.allSettled([
      create(db, 'withdrawal_0001', { withdrawal: 70 }),
      create(db, 'withdrawal_0002', { withdrawal: 70 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await getDoc(doc(db, 'sessions', sessionId))).data()?.expectedCash,
    ).toBe(30);
  }, 15000);
  it('rejects two independent new entries against one aggregate revision', async () => {
    const db = agent(),
      batch = writeBatch(db);
    const template = {
      sessionId,
      workday: day,
      agentId: 'agent-a',
      agentNameSnapshot: 'Agent A',
      memberId: member.memberId,
      accountNumberSnapshot: member.accountNumber,
      memberNameSnapshot: member.fullName,
      createdAt: serverTimestamp(),
      financialRevision: 1,
      lines: { deposit: line(20) },
    };
    batch.set(doc(db, 'entries', 'entry_00000001'), {
      ...template,
      entryId: 'entry_00000001',
    });
    batch.set(doc(db, 'entries', 'entry_00000002'), {
      ...template,
      entryId: 'entry_00000002',
    });
    batch.update(doc(db, 'sessions', sessionId), {
      totalDeposits: 40,
      expectedCash: 140,
      revision: 1,
      lastMutationId: 'entry_00000001',
    });
    await assertFails(batch.commit());
  });
  it('denies writes to a structurally valid expired session', async () => {
    const oldDay = workday(new Date(times.start.getTime() - 1)),
      oldId = `agent-a_${oldDay}`,
      old = bounds(oldDay);
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore() as unknown as Firestore, 'sessions', oldId),
        {
          ...baseSession(),
          sessionId: oldId,
          workday: oldDay,
          startsAt: Timestamp.fromDate(old.start),
          endsAt: Timestamp.fromDate(old.end),
        },
      );
    });
    await assertFails(
      create(agent(), undefined, { deposit: 20 }, { sessionId: oldId }),
    );
  });
  it.each([0, -1, 1.5, 100000001])(
    'rejects invalid financial amount %s',
    async (n) => await assertFails(create(agent(), undefined, { deposit: n })),
  );
});
describe('roles and immutable audit history', () => {
  it.each(['deposit', 'withdrawal', 'loanInstalment'] as const)(
    'checks and undoes a single %s line',
    async (kind) => {
      await create(agent(), undefined, { [kind]: 20 });
      await assertSucceeds(record(viewer(), true, 1, 'viewer-a', kind));
      await assertSucceeds(record(viewer(), false, 2, 'viewer-a', kind));
    },
  );
  it('checks and undoes one line while preserving earlier events', async () => {
    await create(agent(), undefined, { deposit: 20, loanInstalment: 10 });
    const db = viewer();
    await assertSucceeds(record(db));
    await assertSucceeds(record(db, false, 2));
    const e = (await getDoc(doc(db, 'entries', 'entry_00000001'))).data()!;
    expect(e.lines.deposit.recorded).toBe(false);
    expect(Object.keys(e.lines.deposit.recordingHistory)).toEqual(['1', '2']);
    expect(e.lines.loanInstalment.recordingRevision).toBe(0);
    expect(
      (await getDoc(doc(db, 'sessions', sessionId))).data()?.expectedCash,
    ).toBe(130);
  });
  it('denies spoofed actors, history rewrites and skipped revisions', async () => {
    await create(agent());
    const db = viewer();
    await assertFails(record(db, true, 1, 'another-viewer'));
    await record(db);
    await assertFails(
      updateDoc(doc(db, 'entries', 'entry_00000001'), {
        'lines.deposit.recordingHistory.1.by': 'another-viewer',
      }),
    );
    await assertFails(record(db, false, 3));
  });
  it('denies recording voided lines and limits audit growth', async () => {
    await create(agent());
    await voidLine(agent());
    await assertFails(record(viewer()));
    await env.withSecurityRulesDisabled(async (c) =>
      updateDoc(
        doc(c.firestore() as unknown as Firestore, 'entries', 'entry_00000001'),
        {
          'lines.deposit.state': 'active',
          'lines.deposit.recordingRevision': 40,
        },
      ),
    );
    await assertFails(record(viewer(), true, 41));
  });
  it('denies viewer financial changes and agent checks', async () => {
    await create(agent());
    await assertFails(create(viewer(), 'entry_00000002'));
    await assertFails(voidLine(viewer()));
    await assertFails(record(agent(), true, 1, 'agent-a'));
    await assertFails(
      updateDoc(doc(viewer(), 'sessions', sessionId), { expectedCash: 999 }),
    );
  });
  it('isolates agents, requires authentication and active profiles', async () => {
    const other = env
      .authenticatedContext('agent-b')
      .firestore() as unknown as Firestore;
    await create(agent());
    await assertFails(getDoc(doc(other, 'entries', 'entry_00000001')));
    await assertFails(getDocs(collection(other, 'sessions')));
    await assertSucceeds(
      getDocs(
        query(
          collection(agent(), 'entries'),
          where('agentId', '==', 'agent-a'),
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          env.unauthenticatedContext().firestore() as unknown as Firestore,
          'members',
          '137',
        ),
      ),
    );
    await assertFails(
      updateDoc(
        doc(
          env
            .authenticatedContext('inactive')
            .firestore() as unknown as Firestore,
          'sessions',
          sessionId,
        ),
        { expectedCash: 999 },
      ),
    );
  });
  it('allows only owner-role directory writes and denies self-promotion', async () => {
    const admin = env
      .authenticatedContext('admin-a')
      .firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(admin, 'members', '137'), {
        fullName: 'New name',
        searchName: 'new name',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(agent(), 'members', '137'), {
        fullName: 'Other',
        searchName: 'other',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(agent(), 'users', 'agent-a'), { role: 'admin' }),
    );
    await assertFails(getDoc(doc(admin, 'sessions', sessionId)));
  });
  it('creates multiple reserved numeric accounts for one member and accepts ABC group ownership', async () => {
    const db = env
      .authenticatedContext('admin-a')
      .firestore() as unknown as Firestore;
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const refs = Array.from({ length: 5 }, (_, i) =>
          doc(db, 'members', `acct_${900000 + i}`),
        );
        await Promise.all(refs.map((r) => tx.get(r)));
        refs.forEach((ref, i) => {
          const number = String(900000 + i),
            id = `acct_${number}`;
          tx.set(doc(db, 'accountNumbers', number), {
            memberId: id,
            updatedAt: serverTimestamp(),
          });
          tx.set(ref, {
            ...member,
            memberId: id,
            accountNumber: number,
            uniqueNumber: i === 4 ? 'ABC 2' : 'LCT002',
            updatedAt: serverTimestamp(),
          });
        });
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'members', 'acct_900004'), {
        fullName: 'Example group',
        searchName: 'example group',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'members', 'acct_900004'), {
        uniqueNumber: 'LCT002',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'members', 'acct_900004'), {
        accountNumber: '999',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'members', 'acct_900004'), {
        extra: 'forged',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'members', 'acct_900004'), {
        fullName: 'x'.repeat(121),
        searchName: 'x'.repeat(121),
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('adds member identity without changing old account snapshots and validates new snapshot identity', async () => {
    const { uniqueNumber, ...legacy } = member;
    await env.withSecurityRulesDisabled(async (c) =>
      setDoc(
        doc(c.firestore() as unknown as Firestore, 'members', '137'),
        legacy,
      ),
    );
    const field = agent();
    await create(field);
    const db = env
      .authenticatedContext('admin-a')
      .firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(db, 'members', '137'), {
        uniqueNumber: 'LCT002',
        updatedAt: serverTimestamp(),
      }),
    );
    expect(
      (await getDoc(doc(field, 'entries', 'entry_00000001'))).data()!
        .accountNumberSnapshot,
    ).toBe(member.accountNumber);
    await assertSucceeds(
      create(
        field,
        'entry_00000002',
        { deposit: 10 },
        { uniqueNumberSnapshot: 'LCT002' },
      ),
    );
    await assertFails(
      create(
        field,
        'entry_00000003',
        { deposit: 10 },
        { uniqueNumberSnapshot: 'LCT003' },
      ),
    );
    await assertFails(
      updateDoc(doc(field, 'entries', 'entry_00000002'), {
        uniqueNumberSnapshot: 'LCT003',
      }),
    );
  });
  it('restores earlier LCT-number records only through a matching original member number', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore() as unknown as Firestore;
      const { uniqueNumber, ...legacy } = member;
      await setDoc(doc(db, 'members', '137'), {
        ...legacy,
        accountNumber: 'LCT002',
      });
    });
    const db = env
      .authenticatedContext('admin-a')
      .firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, 'members', '137'), {
        accountNumber: member.accountNumber,
        uniqueNumber: 'LCT003',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'members', '137'), {
        accountNumber: member.accountNumber,
        uniqueNumber: 'LCT002',
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('rejects malformed member numbers, unreserved accounts and forged account identities', async () => {
    const db = env
      .authenticatedContext('admin-a')
      .firestore() as unknown as Firestore;
    for (const [id, number, unique] of [
      ['acct_9001', '9001', 'abc2'],
      ['acct_9001', '9001', 'ABC  2'],
      ['acct_9001', '9001', 'ABC'],
      ['LCT002', '9001', 'LCT002'],
      ['acct_9001', '9002', 'LCT002'],
    ]) {
      const b = writeBatch(db);
      b.set(doc(db, 'accountNumbers', number), {
        memberId: id,
        updatedAt: serverTimestamp(),
      });
      b.set(doc(db, 'members', id), {
        ...member,
        memberId: id,
        accountNumber: number,
        uniqueNumber: unique,
        updatedAt: serverTimestamp(),
      });
      await assertFails(b.commit());
    }
  });
  it('rejects unreserved member numbers and reservation reassignment', async () => {
    const db = env
      .authenticatedContext('admin-a')
      .firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, 'members', '137'), {
        accountNumber: '999',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'accountNumbers', member.accountNumber), {
        memberId: '999',
      }),
    );
    const batch = writeBatch(db);
    batch.set(doc(db, 'members', '999'), {
      ...member,
      memberId: '999',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'accountNumbers', member.accountNumber), {
      memberId: '999',
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
    await assertFails(
      getDoc(doc(agent(), 'accountNumbers', member.accountNumber)),
    );
  });
  it('revokes existing agent access when its profile becomes inactive', async () => {
    const db = agent();
    await create(db);
    await env.withSecurityRulesDisabled(async (c) =>
      updateDoc(
        doc(c.firestore() as unknown as Firestore, 'users', 'agent-a'),
        { active: false },
      ),
    );
    await assertFails(getDoc(doc(db, 'entries', 'entry_00000001')));
    await assertFails(create(db, 'entry_00000002'));
  });
  it('rejects a canonical future-day session', async () => {
    const future = workday(new Date(times.end.getTime() + 1)),
      b = bounds(future),
      id = `agent-b_${future}`;
    await assertFails(
      setDoc(
        doc(
          env
            .authenticatedContext('agent-b')
            .firestore() as unknown as Firestore,
          'sessions',
          id,
        ),
        {
          ...baseSession(),
          agentId: 'agent-b',
          sessionId: id,
          workday: future,
          startsAt: Timestamp.fromDate(b.start),
          endsAt: Timestamp.fromDate(b.end),
          createdAt: serverTimestamp(),
        },
      ),
    );
  });
  it('creates only a canonical current-day session once', async () => {
    const db = env
        .authenticatedContext('agent-b')
        .firestore() as unknown as Firestore,
      id = `agent-b_${day}`,
      ref = doc(db, 'sessions', id);
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(
      setDoc(ref, {
        ...baseSession(),
        sessionId: id,
        agentId: 'agent-b',
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(ref, {
        ...baseSession(),
        sessionId: id,
        agentId: 'agent-b',
        createdAt: serverTimestamp(),
      }),
    );
  });
});
