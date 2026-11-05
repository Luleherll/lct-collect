import { beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
const enabled = process.env.LCT_REMINDER_TESTS === 'true';
let backend: typeof import('../functions/src/index');
let db: import('firebase-admin/firestore').Firestore;
const call = (uid: string | undefined, data: unknown) =>
  backend.manageNote.run({
    data,
    auth: uid ? { uid, token: {} } : undefined,
    rawRequest: {},
  } as any);
const save = (noteId: string, patch: Record<string, unknown> = {}) => ({
  action: 'save',
  noteId,
  body: 'Remember the passbook',
  members: [],
  reminder: { kind: 'none' },
  expectedRevision: 0,
  mutationId: randomUUID(),
  ...patch,
});
describe.skipIf(!enabled)(
  'authenticated reminder API and state transitions',
  () => {
    beforeAll(async () => {
      if (
        !/^(localhost|127\.0\.0\.1):[0-9]+$/.test(
          process.env.FIRESTORE_EMULATOR_HOST ?? '',
        )
      )
        throw new Error('Local emulator only');
      process.env.GCLOUD_PROJECT = 'demo-lct-collect';
      process.env.REMINDER_SIGNING_KEY =
        'emulator-only-key-never-use-for-deployment';
      backend = await import('../functions/src/index');
      const admin = await import('firebase-admin/app');
      const firestore = await import('firebase-admin/firestore');
      const app =
        admin.getApps().find((a) => a.name === 'reminder-test') ??
        admin.initializeApp({ projectId: 'demo-lct-collect' }, 'reminder-test');
      db = firestore.getFirestore(app);
    });
    it('rejects unauthenticated and non-agent mutations', async () => {
      await expect(call(undefined, save(randomUUID()))).rejects.toMatchObject({
        code: 'unauthenticated',
      });
      for (const uid of ['demo-viewer', 'demo-admin', 'missing-user'])
        await expect(call(uid, save(randomUUID()))).rejects.toMatchObject({
          code: 'permission-denied',
        });
    });
    it('normalises member tags server-side and keeps owner, timestamps and schedules server-controlled', async () => {
      const noteId = randomUUID();
      const member = (await db.collection('members').limit(1).get()).docs[0];
      await call(
        'demo-agent',
        save(noteId, {
          members: [member.id, member.id],
          uid: 'demo-viewer',
          done: true,
          dueAt: 123,
        }),
      );
      const note = (
        await db.doc(`users/demo-agent/notes/${noteId}`).get()
      ).data()!;
      expect(note.uid).toBe('demo-agent');
      expect(note.done).toBe(false);
      expect(note.dueAt).toBeNull();
      expect(note.tags).toHaveLength(1);
      expect(note.tags[0].fullName).toBe(member.data().fullName);
      expect(
        (await db.doc(`users/demo-viewer/notes/${noteId}`).get()).exists,
      ).toBe(false);
    });
    it('rejects invalid schedules, past dates, oversized notes and too many tags', async () => {
      for (const patch of [
        { reminder: { kind: 'once', at: 1 } },
        { reminder: { kind: 'weekly', day: 9, minute: 60 } },
        { body: 'x'.repeat(2001) },
        { members: Array(11).fill('001') },
      ])
        await expect(
          call('demo-agent', save(randomUUID(), patch)),
        ).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    it('is idempotent and detects concurrent edits without overwriting', async () => {
      const noteId = randomUUID(),
        request = save(noteId);
      await call('demo-agent', request);
      await call('demo-agent', request);
      expect(
        (await db.doc(`users/demo-agent/notes/${noteId}`).get()).data()
          ?.revision,
      ).toBe(1);
      await expect(
        call('demo-agent', { ...request, body: 'Different' }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
      await expect(
        call('demo-agent', save(noteId, { body: 'Stale edit' })),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
    });
    it('soft deletes legacy notes without losing their contents, rejects stale deletes and cannot resurrect them', async () => {
      const noteId = randomUUID(),
        ref = db.doc(`users/demo-agent/notes/${noteId}`);
      const { Timestamp } = await import('firebase-admin/firestore');
      await ref.set({
        noteId,
        body: 'Legacy private note',
        createdAt: Timestamp.now(),
      });
      const request = {
        action: 'delete',
        noteId,
        expectedRevision: 0,
        mutationId: randomUUID(),
      };
      await expect(
        call('demo-agent', { ...request, expectedRevision: 1 }),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      await expect(call('demo-viewer', request)).rejects.toMatchObject({
        code: 'permission-denied',
      });
      await call('demo-agent', request);
      await call('demo-agent', request);
      expect((await ref.get()).exists).toBe(false);
      const archive = (
        await db.doc(`users/demo-agent/deletedNotes/${noteId}`).get()
      ).data()!;
      expect(archive.body).toBe('Legacy private note');
      expect(archive.deletedBy).toBe('demo-agent');
      expect(archive.deletedAt.toMillis()).toBeGreaterThan(0);
      expect(archive.dueAt).toBeNull();
      await expect(call('demo-agent', save(noteId))).rejects.toMatchObject({
        code: 'failed-precondition',
      });
    });
    it('completes and reopens one-off notes without replaying past/delivered reminders', async () => {
      const noteId = randomUUID(),
        at = Date.now() + 3600000;
      await call(
        'demo-agent',
        save(noteId, { reminder: { kind: 'once', at } }),
      );
      const done = (value: boolean, revision: number) => ({
        action: 'done',
        noteId,
        done: value,
        expectedRevision: revision,
        occurrenceAt: at,
        mutationId: randomUUID(),
      });
      await call('demo-agent', done(true, 1));
      expect(
        (await db.doc(`users/demo-agent/notes/${noteId}`).get()).data()?.dueAt,
      ).toBeNull();
      await call('demo-agent', done(false, 2));
      expect(
        (await db.doc(`users/demo-agent/notes/${noteId}`).get())
          .data()
          ?.dueAt.toMillis(),
      ).toBe(at);
      await db
        .doc(`users/demo-agent/notes/${noteId}`)
        .update({ lastQueuedOccurrence: at });
      await call('demo-agent', done(true, 3));
      await call('demo-agent', done(false, 4));
      expect(
        (await db.doc(`users/demo-agent/notes/${noteId}`).get()).data()?.dueAt,
      ).toBeNull();
    });
    it('replaces schedules across kinds and repairs old deep-merged reminder maps', async () => {
      const noteId = randomUUID(),
        ref = db.doc(`users/demo-agent/notes/${noteId}`);
      const weekly = { kind: 'weekly', day: 5, minute: 540 };
      const once = {
        kind: 'once',
        at: Math.ceil((Date.now() + 86400000) / 60000) * 60000,
      };
      await call('demo-agent', save(noteId, { reminder: weekly }));
      const created = (await ref.get()).data()!;
      await call(
        'demo-agent',
        save(noteId, { reminder: once, expectedRevision: 1 }),
      );
      expect((await ref.get()).data()?.reminder).toEqual(once);
      await call(
        'demo-agent',
        save(noteId, {
          body: 'Edit again after changing reminder',
          reminder: once,
          expectedRevision: 2,
        }),
      );
      await call(
        'demo-agent',
        save(noteId, { reminder: { kind: 'none' }, expectedRevision: 3 }),
      );
      expect((await ref.get()).data()?.reminder).toEqual({ kind: 'none' });
      await call(
        'demo-agent',
        save(noteId, { reminder: weekly, expectedRevision: 4 }),
      );
      expect((await ref.get()).data()?.reminder).toEqual(weekly);
      await call(
        'demo-agent',
        save(noteId, { reminder: once, expectedRevision: 5 }),
      );
      const before = (await ref.get()).data()!;
      await ref.update({ reminder: { ...weekly, ...once } });
      await call(
        'demo-agent',
        save(noteId, { reminder: once, expectedRevision: 6 }),
      );
      const repaired = (await ref.get()).data()!;
      expect(repaired.reminder).toEqual(once);
      expect(repaired.scheduleVersion).toBe(before.scheduleVersion);
      expect(repaired.createdAt.toMillis()).toBe(created.createdAt.toMillis());
      expect(repaired.uid).toBe('demo-agent');
      expect(repaired.revision).toBe(7);
    });
    it('keeps weekly schedule identity on text edits and rejects completion of stale occurrences', async () => {
      const noteId = randomUUID(),
        reminder = { kind: 'weekly', day: 1, minute: 540 };
      await call('demo-agent', save(noteId, { reminder }));
      const before = (
        await db.doc(`users/demo-agent/notes/${noteId}`).get()
      ).data()!;
      await call(
        'demo-agent',
        save(noteId, { body: 'Edited', reminder, expectedRevision: 1 }),
      );
      const after = (
        await db.doc(`users/demo-agent/notes/${noteId}`).get()
      ).data()!;
      expect(after.scheduleVersion).toBe(before.scheduleVersion);
      expect(after.occurrenceAt).toBe(before.occurrenceAt);
      await expect(
        call('demo-agent', {
          action: 'done',
          noteId,
          done: true,
          expectedRevision: 2,
          occurrenceAt: 1,
          mutationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
    });
  },
);

describe.skipIf(!enabled)('reminder dispatch and device ownership', () => {
  it('reopens the next weekly occurrence without replaying an earlier completed one', async () => {
    const noteId = randomUUID();
    await call(
      'demo-agent',
      save(noteId, { reminder: { kind: 'weekly', day: 1, minute: 540 } }),
    );
    const { Timestamp } = await import('firebase-admin/firestore');
    const occurrence = Date.now() - 60000,
      ref = db.doc(`users/demo-agent/notes/${noteId}`);
    await ref.update({
      dueAt: Timestamp.fromMillis(occurrence),
      occurrenceAt: occurrence,
      done: true,
      completedOccurrence: occurrence,
    });
    await backend.dispatchReminders.run({
      jobName: 'test',
      scheduleTime: new Date().toISOString(),
    });
    let n = (await ref.get()).data()!;
    expect(n.done).toBe(true);
    expect(n.dueAt.toMillis()).toBeGreaterThan(Date.now());
    const next = Date.now() - 1000;
    await ref.update({ dueAt: Timestamp.fromMillis(next) });
    await backend.dispatchReminders.run({
      jobName: 'test',
      scheduleTime: new Date().toISOString(),
    });
    n = (await ref.get()).data()!;
    expect(n.done).toBe(false);
    expect(n.occurrenceAt).toBe(next);
  });
  it('moves a shared device to its current authenticated agent and rejects stale queued alerts', async () => {
    const { createHash, createHmac } = await import('node:crypto');
    const { Timestamp } = await import('firebase-admin/firestore');
    await db
      .doc('users/second-agent')
      .set({ role: 'agent', active: true, displayName: 'Second agent' });
    const token = 'test-token-' + randomUUID(),
      deviceId = createHash('sha256').update(token).digest('hex'),
      browserId = randomUUID();
    const register = (uid: string, enabled = true) =>
      backend.registerReminderDevice.run({
        data: { token, browserId, enabled },
        auth: { uid, token: {} },
        rawRequest: {},
      } as any);
    await register('demo-agent');
    expect(
      (await db.doc(`reminderDevices/${deviceId}`).get()).data()?.uid,
    ).toBe('demo-agent');
    const noteId = randomUUID(),
      at = Date.now() + 3600000;
    await call('demo-agent', save(noteId, { reminder: { kind: 'once', at } }));
    const deliveryId = createHash('sha256').update(randomUUID()).digest('hex'),
      exp = Date.now() + 3600000;
    await db.doc(`reminderDeliveries/${deliveryId}`).set({
      uid: 'demo-agent',
      deviceId,
      noteId,
      occurrenceAt: at,
      scheduleVersion: 1,
      expiresAt: Timestamp.fromMillis(exp),
    });
    const data = Buffer.from(JSON.stringify({ id: deliveryId, exp })).toString(
        'base64url',
      ),
      ticket =
        data +
        '.' +
        createHmac('sha256', 'emulator-only-key-never-use-for-deployment')
          .update(data)
          .digest('base64url');
    const verify = async (value = ticket) => {
      const r = await fetch(
        'http://127.0.0.1:5001/demo-lct-collect/europe-west1/validateReminder',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ticket: value }),
        },
      );
      return { status: r.status, data: await r.json() };
    };
    expect((await verify()).data.valid).toBe(true);
    expect((await verify('forged')).status).toBe(403);
    await register('second-agent');
    expect((await verify()).data.valid).toBe(false);
    await register('demo-agent');
    await call('demo-agent', {
      action: 'done',
      noteId,
      done: true,
      expectedRevision: 1,
      occurrenceAt: at,
      mutationId: randomUUID(),
    });
    expect((await verify()).data.valid).toBe(false);
    await call('demo-agent', {
      action: 'done',
      noteId,
      done: false,
      expectedRevision: 2,
      occurrenceAt: at,
      mutationId: randomUUID(),
    });
    expect((await verify()).data.valid).toBe(true);
    await call('demo-agent', {
      action: 'delete',
      noteId,
      expectedRevision: 3,
      mutationId: randomUUID(),
    });
    expect((await verify()).data.valid).toBe(false);
    expect(
      (await db.doc(`users/demo-agent/deletedNotes/${noteId}`).get()).data()
        ?.dueAt,
    ).toBeNull();
    await register('demo-agent', false);
  });
});
