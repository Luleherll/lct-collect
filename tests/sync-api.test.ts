import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dayAt, type Command } from '../functions/src/protocol';
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
    const sessionId = `${uid}_future`,
      entryId = randomUUID(),
      { Timestamp } = await import('firebase-admin/firestore');
    await db
      .doc(`sessions/${sessionId}`)
      .set({
        agentId: uid,
        workday: dayAt(Date.now() + 86400000),
        startsAt: Timestamp.fromMillis(Date.now() + 3600000),
        endsAt: Timestamp.fromMillis(Date.now() + 86400000),
        revision: 0,
      });
    await db
      .doc(`entries/${entryId}`)
      .set({
        agentId: uid,
        sessionId,
        lines: { deposit: { state: 'active', recorded: false, amount: 10 } },
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
  });
});
