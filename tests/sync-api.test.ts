import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  dayAt,
  dayStart,
  newLines,
  type Command,
} from '../functions/src/protocol';
const enabled = process.env.LCT_REMINDER_TESTS === 'true';
let backend: typeof import('../functions/src/index');
let db: import('firebase-admin/firestore').Firestore;
const uid = 'sync-test-agent';
const call = (c: Command, actor = uid) =>
  backend.syncOperation.run({
    data: c,
    auth: { uid: actor, token: {} },
    rawRequest: {},
  } as any);
const command = (
  kind: Command['kind'],
  scope: string,
  data: Record<string, any>,
): Command => ({
  version: 1,
  id: randomUUID(),
  deviceId: randomUUID(),
  sequence: 1,
  capturedAt: Date.now(),
  kind,
  scope,
  dependsOn: null,
  data,
});
describe.skipIf(!enabled)('durable financial sync API', () => {
  beforeAll(async () => {
    if (
      !/^(localhost|127\.0\.0\.1):[0-9]+$/.test(
        process.env.FIRESTORE_EMULATOR_HOST ?? '',
      )
    )
      throw new Error('Local emulator only');
    process.env.GCLOUD_PROJECT = 'demo-lct-collect';
    backend = await import('../functions/src/index');
    const app = (await import('firebase-admin/app')).initializeApp(
      { projectId: 'demo-lct-collect' },
      'sync-api-tests',
    );
    db = (await import('firebase-admin/firestore')).getFirestore(app);
    await db
      .doc(`users/${uid}`)
      .set({ role: 'agent', active: true, displayName: 'Sync Agent' });
    await db.doc('members/sync-member').set({
      memberId: 'sync-member',
      fullName: 'Sync Member',
      accountNumber: '123456',
      uniqueNumber: 'LCT123',
      active: true,
    });
  });
  it('atomically saves paired entries, retries once, and records/voids each line independently', async () => {
    const agent = 'pair-' + randomUUID(),
      viewer = 'pair-viewer-' + randomUUID(),
      day = dayAt(Date.now()),
      sessionId = `${agent}_${day}`;
    await db
      .doc(`users/${agent}`)
      .set({ role: 'agent', active: true, displayName: 'Pair Agent' });
    await db
      .doc(`users/${viewer}`)
      .set({ role: 'viewer', active: true, displayName: 'Pair Viewer' });
    const member = {
      memberId: 'pair-member',
      fullName: 'Pair Member',
      uniqueNumber: 'LCTPAIR',
      accountNumber: '001',
      active: true,
    };
    await db.doc('members/pair-member').set(member);
    await db
      .doc('members/pair-other')
      .set({ ...member, memberId: 'pair-other', accountNumber: '002' });
    await call(
      command('session', `session:${sessionId}`, {
        sessionId,
        workday: day,
        openingCash: 0,
      }),
      agent,
    );
    const entryId = randomUUID(),
      fixedEntryId = randomUUID();
    const pair = command('entryPair', `session:${sessionId}`, {
      sessionId,
      entryId,
      fixedEntryId,
      member,
      otherAccountId: 'pair-other',
      note: 'Paired',
      accountTypes: {},
      values: { deposit: 1000, withdrawal: 1000, loanInstalment: 0 },
      splitAmounts: {
        deposit: { saving: 100, fixed: 900 },
        withdrawal: { saving: 800, fixed: 200 },
      },
    });
    const result = await call(pair, agent);
    expect(result.status).not.toBe('rejected');
    expect(await call(pair, agent)).toEqual(result);
    expect((await db.doc(`sessions/${sessionId}`).get()).data()).toMatchObject({
      expectedCash: 0,
      totalDeposits: 1000,
      totalWithdrawals: 1000,
      revision: 1,
    });
    for (const [id, account] of [
      [entryId, 'saving'],
      [fixedEntryId, 'fixed'],
    ]) {
      const e = (await db.doc(`entries/${id}`).get()).data()!;
      expect(e.submissionGroupId).toBe(pair.id);
      for (const type of ['deposit', 'withdrawal']) {
        expect(e.lines[type].accountType).toBe(account);
        const mark = command('record', `record:${id}:${type}`, {
          entryId: id,
          type,
          recorded: true,
          expectedRevision: 0,
        });
        expect((await call(mark, viewer)).status).not.toBe('rejected');
      }
    }
    await call(
      command('record', `record:${fixedEntryId}:withdrawal`, {
        entryId: fixedEntryId,
        type: 'withdrawal',
        recorded: false,
        expectedRevision: 1,
      }),
      viewer,
    );
    const voided = await call(
      command('void', `session:${sessionId}`, {
        sessionId,
        entryId: fixedEntryId,
        type: 'withdrawal',
        reason: 'Correct fixed withdrawal',
      }),
      agent,
    );
    expect(voided.status).not.toBe('rejected');
    expect(
      (await db.doc(`sessions/${sessionId}`).get()).data()!.expectedCash,
    ).toBe(200);
    expect(
      (await db.doc(`entries/${entryId}`).get()).data()!.lines.withdrawal.state,
    ).toBe('active');
    // Invalid second account leaves neither entry nor a changed cash total.
    const bad = command('entryPair', `session:${sessionId}`, {
      ...pair.data,
      entryId: randomUUID(),
      fixedEntryId: randomUUID(),
      otherAccountId: 'missing-member',
    });
    expect((await call(bad, agent)).status).toBe('rejected');
    for (const id of [bad.data.entryId, bad.data.fixedEntryId])
      expect((await db.doc(`entries/${id}`).get()).exists).toBe(false);
    expect(
      (await db.doc(`sessions/${sessionId}`).get()).data()!.expectedCash,
    ).toBe(200);
    const collision = command('entryPair', `session:${sessionId}`, {
      ...pair.data,
      entryId: randomUUID(),
      fixedEntryId,
    });
    expect((await call(collision, agent)).status).toBe('rejected');
    expect(
      (await db.doc(`entries/${collision.data.entryId}`).get()).exists,
    ).toBe(false);
  });
  it('serializes competing paired withdrawals without posting either half of a rejection', async () => {
    const agent = 'pair-race-' + randomUUID(),
      day = dayAt(Date.now()),
      sessionId = `${agent}_${day}`;
    await db
      .doc(`users/${agent}`)
      .set({ role: 'agent', active: true, displayName: 'Pair Race' });
    const member = {
      memberId: 'pair-race-main',
      fullName: 'Pair Race',
      uniqueNumber: 'LCT777',
      accountNumber: '7771',
      active: true,
    };
    await db.doc('members/pair-race-main').set(member);
    await db
      .doc('members/pair-race-other')
      .set({ ...member, memberId: 'pair-race-other', accountNumber: '7772' });
    await call(
      command('session', `session:${sessionId}`, {
        sessionId,
        workday: day,
        openingCash: 1000,
      }),
      agent,
    );
    const make = () =>
      command('entryPair', `session:${sessionId}`, {
        sessionId,
        entryId: randomUUID(),
        fixedEntryId: randomUUID(),
        member,
        otherAccountId: 'pair-race-other',
        note: '',
        accountTypes: {},
        values: { deposit: 0, withdrawal: 600, loanInstalment: 0 },
        splitAmounts: { withdrawal: { saving: 300, fixed: 300 } },
      });
    const commands = [make(), make()],
      results = await Promise.all(commands.map((c) => call(c, agent)));
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      (await db.doc(`sessions/${sessionId}`).get()).data()!.expectedCash,
    ).toBe(400);
    for (const [index, c] of commands.entries())
      for (const id of [c.data.entryId, c.data.fixedEntryId])
        expect((await db.doc(`entries/${id}`).get()).exists).toBe(
          results[index].status !== 'rejected',
        );
  });
  it('accepts late work under the original workday and never duplicates after a lost response', async () => {
    const time = Date.now() - 2 * 86400000,
      day = dayAt(time),
      sessionId = `${uid}_${day}`;
    const start = command('session', `session:${sessionId}`, {
      sessionId,
      workday: day,
      openingCash: 100,
    });
    start.capturedAt = time;
    await call(start);
    const entryId = randomUUID(),
      entry = command('entry', `session:${sessionId}`, {
        sessionId,
        entryId,
        member: {
          memberId: 'sync-member',
          fullName: 'Sync Member',
          accountNumber: '123456',
          uniqueNumber: 'LCT123',
        },
        values: { deposit: 50, withdrawal: 0, loanInstalment: 0 },
        note: '',
        accountTypes: {},
      });
    entry.capturedAt = time;
    await call(entry);
    await call(entry);
    expect(
      (await db.doc(`sessions/${sessionId}`).get()).data()!.expectedCash,
    ).toBe(150);
    const saved = (await db.doc(`entries/${entryId}`).get()).data()!;
    expect(saved.workday).toBe(day);
    expect(saved.lateSubmission).toBe(true);
    await expect(
      call({
        ...entry,
        data: {
          ...entry.data,
          values: { deposit: 60, withdrawal: 0, loanInstalment: 0 },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    const voided = command('void', `session:${sessionId}`, {
      sessionId,
      entryId,
      type: 'deposit',
      reason: 'Late correction',
    });
    await expect(call(voided)).resolves.toMatchObject({
      status: 'rejected',
      code: 'failed-precondition',
    });
  });
  it('keeps an expired void rejected while a reviewed descendant posts once under its original workday', async () => {
    const captured = Date.now() - 3 * 86400000,
      day = dayAt(captured),
      sessionId = `${uid}_${day}`,
      scope = `session:${sessionId}`;
    const start = command('session', scope, {
      sessionId,
      workday: day,
      openingCash: 100,
    });
    start.capturedAt = captured;
    await call(start);
    const original = command('entry', scope, {
      sessionId,
      entryId: randomUUID(),
      member: {
        memberId: 'sync-member',
        fullName: 'Sync Member',
        accountNumber: '123456',
        uniqueNumber: 'LCT123',
      },
      values: { deposit: 50, withdrawal: 0, loanInstalment: 0 },
      note: '',
      accountTypes: {},
    });
    original.capturedAt = captured;
    await call(original);
    const voided = command('void', scope, {
      sessionId,
      entryId: original.data.entryId,
      type: 'deposit',
      reason: 'Offline void before cutoff',
    });
    voided.capturedAt = captured;
    await expect(call(voided)).resolves.toMatchObject({ status: 'rejected' });
    const blocked = command('entry', scope, {
      ...original.data,
      entryId: randomUUID(),
      values: { deposit: 25, withdrawal: 0, loanInstalment: 0 },
    });
    blocked.capturedAt = captured;
    blocked.dependsOn = voided.id;
    await expect(call(blocked)).resolves.toMatchObject({ status: 'rejected' });
    const reviewed = {
      ...blocked,
      id: randomUUID(),
      supersedes: blocked.id,
      dependsOn: null,
    };
    await expect(call(reviewed)).resolves.not.toHaveProperty(
      'status',
      'rejected',
    );
    await call(reviewed);
    await expect(call(voided)).resolves.toMatchObject({ status: 'rejected' });
    await expect(call(blocked)).resolves.toMatchObject({ status: 'rejected' });
    const session = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(session.expectedCash).toBe(175);
    expect(
      (await db.doc(`entries/${original.data.entryId}`).get()).data()!.lines
        .deposit.state,
    ).toBe('active');
    const late = (
      await db.doc(`entries/${blocked.data.entryId}`).get()
    ).data()!;
    expect(late.capturedAt.toMillis()).toBe(captured);
    expect(late.lateSubmission).toBe(true);
    expect(
      (await db.collection('entries').where('sessionId', '==', sessionId).get())
        .size,
    ).toBe(2);
  });
  it('rejects role spoofing and invalid cash', async () => {
    const day = dayAt(Date.now()),
      sessionId = `${uid}_${day}`,
      start = command('session', `session:${sessionId}`, {
        sessionId,
        workday: day,
        openingCash: -1,
      });
    await expect(call(start)).resolves.toMatchObject({
      status: 'rejected',
      code: 'failed-precondition',
    });
    await expect(
      call(
        { ...start, data: { ...start.data, openingCash: 0 } },
        'demo-viewer',
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('serializes competing withdrawals without negative cash and persists terminal rejection', async () => {
    const day = dayAt(Date.now()),
      sessionId = `${uid}_${day}`;
    await call(
      command('session', `session:${sessionId}`, {
        sessionId,
        workday: day,
        openingCash: 100,
      }),
    );
    const make = () =>
      command('entry', `session:${sessionId}`, {
        sessionId,
        entryId: randomUUID(),
        member: {
          memberId: 'sync-member',
          fullName: 'Sync Member',
          accountNumber: '123456',
          uniqueNumber: 'LCT123',
        },
        values: { deposit: 0, withdrawal: 80, loanInstalment: 0 },
        note: '',
        accountTypes: {},
      });
    const a = make(),
      b = make(),
      results = await Promise.all([call(a), call(b)]);
    expect(results.filter((r: any) => r.status === 'rejected')).toHaveLength(1);
    expect(
      (await db.doc(`sessions/${sessionId}`).get()).data()!.expectedCash,
    ).toBe(20);
    const rejected = results[0].status === 'rejected' ? a : b;
    await db
      .doc(`sessions/${sessionId}`)
      .update({ expectedCash: 100, totalWithdrawals: 0 });
    expect(await call(rejected)).toMatchObject({ status: 'rejected' });
  });
  it('acknowledges a note retry after a later edit without rolling back or duplicating revisions', async () => {
    const noteId = randomUUID(),
      first = command('note', `note:${noteId}`, {
        action: 'save',
        noteId,
        body: 'First version',
        members: [],
        reminder: { kind: 'none' },
        expectedRevision: 0,
      });
    first.data.mutationId = first.id;
    const ack = await call(first);
    expect(ack.revision).toBe(1);
    const second = command('note', `note:${noteId}`, {
      ...first.data,
      body: 'Second version',
      expectedRevision: 1,
    });
    second.data.mutationId = second.id;
    second.dependsOn = first.id;
    await call(second);
    await call(first);
    expect(
      (await db.doc(`users/${uid}/notes/${noteId}`).get()).data(),
    ).toMatchObject({ body: 'Second version', revision: 2 });
  });
  it('rejects commands bound to another actor for both financial work and private notes', async () => {
    const financial = command('session', `session:${uid}_2026-01-01`, {
      sessionId: `${uid}_2026-01-01`,
      workday: '2026-01-01',
      openingCash: 0,
    });
    financial.actorId = 'another-agent';
    await expect(call(financial)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    const noteId = randomUUID(),
      note = command('note', `note:${noteId}`, {
        action: 'save',
        noteId,
        body: 'Private',
        members: [],
        reminder: { kind: 'none' },
        expectedRevision: 0,
      });
    note.actorId = 'another-agent';
    note.data.mutationId = note.id;
    await expect(call(note)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect((await db.doc(`users/${uid}/notes/${noteId}`).get()).exists).toBe(
      false,
    );
  });
  it('does not void a session before its operational start', async () => {
    const futureDay = dayAt(Date.now() + 86400000),
      sessionId = `${uid}_${futureDay}`,
      entryId = randomUUID(),
      { Timestamp } = await import('firebase-admin/firestore');
    await db.doc(`sessions/${sessionId}`).set({
      sessionId,
      agentId: uid,
      workday: futureDay,
      startsAt: Timestamp.fromMillis(dayStart(futureDay)),
      endsAt: Timestamp.fromMillis(dayStart(futureDay) + 86400000),
      openingCash: 100,
      totalDeposits: 10,
      totalWithdrawals: 0,
      totalLoanInstalments: 0,
      expectedCash: 110,
      revision: 1,
      lastMutationId: entryId,
      createdAt: Timestamp.now(),
    });
    await db.doc(`entries/${entryId}`).set({
      entryId,
      agentId: uid,
      agentNameSnapshot: 'Sync Agent',
      sessionId,
      workday: futureDay,
      memberId: 'sync-member',
      memberNameSnapshot: 'Sync Member',
      accountNumberSnapshot: '123456',
      createdAt: Timestamp.now(),
      financialRevision: 1,
      lines: newLines({ deposit: 10, withdrawal: 0, loanInstalment: 0 }),
    });
    await expect(
      call(
        command('void', `session:${sessionId}`, {
          entryId,
          sessionId,
          type: 'deposit',
          reason: 'Before start',
        }),
      ),
    ).resolves.toMatchObject({ status: 'rejected' });
    expect(
      (await db.doc(`entries/${entryId}`).get()).data()!.lines.deposit.state,
    ).toBe('active');
    expect(
      (await db.doc(`sessions/${sessionId}`).get()).data()!.expectedCash,
    ).toBe(110);
  });
});
