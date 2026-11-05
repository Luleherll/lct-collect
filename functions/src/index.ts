import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  parseReminder,
  firstOccurrence,
  nextWeekly,
  type Reminder,
} from './schedule.js';
initializeApp();
import {
  financial,
  recordRejection,
  receiptMetadata,
  signature as commandSignature,
  validateCommand,
  wire,
} from './sync.js';
import type { Command, Outcome } from './protocol.js';
const db = getFirestore(),
  signingKey = defineSecret('REMINDER_SIGNING_KEY');
const runtimeAccount = defineString('REMINDER_SERVICE_ACCOUNT', {
  default: 'lct-reminders@lct-collect-staging.iam.gserviceaccount.com',
});
const options = {
  serviceAccount: runtimeAccount,
  region: 'africa-south1',
  maxInstances: 2,
  minInstances: 0,
  memory: '256MiB' as const,
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const nowStamp = () => Timestamp.now();
const bad = (message: string): never => {
  throw new HttpsError('invalid-argument', message);
};
function id(v: unknown) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(v))
    bad('Invalid note reference.');
  return v as string;
}
async function agent(uid?: string) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const p = (await db.doc(`users/${uid}`).get()).data();
  if (p?.active !== true || p.role !== 'agent')
    throw new HttpsError('permission-denied', 'Agent access required.');
  return uid;
}
export const manageNote = onCall(options, async (request) => {
  const uid = await agent(request.auth?.uid);
  return manageNoteData(uid, request.data);
});
async function manageNoteData(uid: string, data: unknown, command?: Command) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    bad('Check the note details.');
  let input = data as Record<string, unknown>;
  const receipt = command
    ? db.doc(`users/${uid}/mutations/${command.id}`)
    : null;
  const commandHash = command ? commandSignature(command) : '';
  if (receipt) {
    const old = await receipt.get();
    if (old.exists) {
      if (old.data()!.hash !== commandHash) bad('Submission reference reused.');
      return old.data()!.outcome;
    }
    if (command!.dependsOn) {
      const dep = await db
        .doc(`users/${uid}/mutations/${command!.dependsOn}`)
        .get();
      if (
        !dep.exists ||
        dep.data()!.scope !== command!.scope ||
        dep.data()!.outcome.status === 'rejected'
      )
        throw new HttpsError(
          'failed-precondition',
          'A preceding note change needs attention.',
        );
      input = {
        ...input,
        expectedRevision: dep.data()!.outcome.revision,
        occurrenceAt: dep.data()!.outcome.occurrenceAt ?? null,
      };
    }
  }
  const noteId = id(input.noteId),
    mutationId = id(input.mutationId),
    ref = db.doc(`users/${uid}/notes/${noteId}`),
    archive = db.doc(`users/${uid}/deletedNotes/${noteId}`);
  if (
    input.action !== 'save' &&
    input.action !== 'done' &&
    input.action !== 'delete'
  )
    bad('Unknown note action.');
  if (
    !Number.isInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 0
  )
    bad('Invalid note version.');
  const signature = hash(JSON.stringify(input));
  let tags: { memberId: string; uniqueNumber: string; fullName: string }[] = [];
  let schedule: Reminder = { kind: 'none' },
    body = '';
  if (input.action === 'save') {
    if (
      typeof input.body !== 'string' ||
      !input.body.trim() ||
      input.body.trim().length > 2000
    )
      bad('Enter a note of up to 2,000 characters.');
    body = (input.body as string).trim();
    try {
      schedule = parseReminder(input.reminder);
    } catch (e) {
      bad((e as Error).message);
    }
    if (
      !Array.isArray(input.members) ||
      input.members.length > 10 ||
      input.members.some(
        (m) =>
          typeof m !== 'string' ||
          !m.length ||
          m.length > 100 ||
          m.includes('/'),
      )
    )
      bad('Tag up to ten members.');
    const seen = new Set<string>();
    for (const memberId of input.members as string[]) {
      const m = (await db.doc(`members/${memberId}`).get()).data();
      if (m?.active !== true || !m.uniqueNumber)
        bad('A tagged member is unavailable. Select them again.');
      if (!seen.has(m!.uniqueNumber)) {
        tags.push({
          memberId,
          uniqueNumber: m!.uniqueNumber,
          fullName: m!.fullName,
        });
        seen.add(m!.uniqueNumber);
      }
    }
  } else if (input.action === 'done' && typeof input.done !== 'boolean')
    bad('Choose a completion state.');
  let outcome: Outcome | undefined;
  await db.runTransaction(async (tx) => {
    const actor = (await tx.get(db.doc(`users/${uid}`))).data();
    if (!actor?.active || actor.role !== 'agent')
      throw new HttpsError('permission-denied', 'Agent access required.');
    if (receipt) {
      const prior = await tx.get(receipt);
      if (prior.exists) {
        if (prior.data()!.hash !== commandHash)
          bad('Submission reference reused.');
        outcome = prior.data()!.outcome;
        return;
      }
    }
    const [snap, archived] = await Promise.all([tx.get(ref), tx.get(archive)]),
      old = snap.data();
    if (archived.exists) {
      if (
        input.action === 'delete' &&
        archived.data()?.lastMutationId === mutationId &&
        archived.data()?.lastMutationHash === signature
      )
        return;
      throw new HttpsError('failed-precondition', 'This note was deleted.');
    }
    if (old?.lastMutationId === mutationId) {
      if (old.lastMutationHash !== signature)
        bad('This save reference was already used.');
      return;
    }
    if ((old?.revision ?? 0) !== input.expectedRevision)
      throw new HttpsError(
        'failed-precondition',
        'This note changed. Reopen it before saving.',
      );
    const now = Date.now();
    const storeReceipt = (record: unknown) => {
      if (receipt) {
        outcome = {
          records: { [ref.path]: wire(record) },
          revision: (old?.revision ?? 0) + 1,
          occurrenceAt: (record as any)?.occurrenceAt ?? null,
        };
        tx.create(receipt, {
          hash: commandHash,
          scope: command!.scope,
          outcome,
          receivedAt: nowStamp(),
          ...receiptMetadata(command!),
        });
      }
    };
    if (input.action === 'delete') {
      if (!old) throw new HttpsError('not-found', 'This note is unavailable.');
      // Retain the complete private record while removing it from active queries,
      // including legacy clients whose notes have no visibility field.
      tx.create(archive, {
        ...old,
        deletedAt: nowStamp(),
        deletedBy: uid,
        updatedAt: nowStamp(),
        revision: (old.revision ?? 0) + 1,
        scheduleVersion: (old.scheduleVersion ?? 0) + 1,
        dueAt: null,
        lastMutationId: mutationId,
        lastMutationHash: signature,
      });
      tx.delete(ref);
      storeReceipt(null);
      return;
    }
    let patch: Record<string, unknown>;
    if (input.action === 'save') {
      // Older deep-merged writes retained fields from the previous reminder kind.
      // Normalize stored data only; incoming schedules still use strict validation.
      const prior = old?.reminder;
      const previous =
        prior?.kind === 'once'
          ? { kind: 'once', at: prior.at }
          : prior?.kind === 'weekly'
            ? { kind: 'weekly', day: prior.day, minute: prior.minute }
            : (prior ?? { kind: 'none' });
      let changed = true;
      try {
        changed =
          JSON.stringify(
            parseReminder(
              previous.kind === 'none' ? { kind: 'none' } : previous,
            ),
          ) !== JSON.stringify(schedule);
      } catch {
        // A validated replacement repairs malformed legacy schedules.
      }
      let first: number | null = null;
      if (changed || !old) {
        try {
          first =
            command && schedule.kind === 'once' && schedule.at <= now
              ? null
              : firstOccurrence(schedule, now);
        } catch (e) {
          bad((e as Error).message);
        }
      }
      patch = {
        noteId,
        body,
        tags,
        reminder: schedule,
        uid,
        updatedAt: nowStamp(),
        revision: (old?.revision ?? 0) + 1,
        ...(!old ? { createdAt: nowStamp() } : {}),
        ...(changed || !old
          ? {
              scheduleVersion: (old?.scheduleVersion ?? 0) + 1,
              occurrenceAt: first,
              completedOccurrence: null,
              done: false,
              dueAt: first ? Timestamp.fromMillis(first) : null,
            }
          : {}),
      };
    } else {
      if (!old) throw new HttpsError('not-found', 'This note is unavailable.');
      if ((input.occurrenceAt ?? null) !== (old.occurrenceAt ?? null))
        throw new HttpsError(
          'failed-precondition',
          'A new occurrence is due. Reopen the note.',
        );
      const r = (old.reminder ?? { kind: 'none' }) as Reminder;
      patch = {
        done: input.done,
        completedOccurrence: input.done ? (old.occurrenceAt ?? 0) : null,
        revision: (old.revision ?? 0) + 1,
        updatedAt: nowStamp(),
      };
      if (r.kind === 'once')
        patch.dueAt =
          !input.done &&
          r.at > now &&
          old.lastQueuedOccurrence !== old.occurrenceAt
            ? Timestamp.fromMillis(r.at)
            : null;
    }
    storeReceipt({ ...old, ...patch });
    tx.set(ref, {
      ...old,
      ...patch,
      lastMutationId: mutationId,
      lastMutationHash: signature,
    });
  });
  return outcome ?? { noteId };
}
export const syncOperation = onCall(options, async (request) => {
  if (!request.auth?.uid)
    throw new HttpsError('unauthenticated', 'Sign in first.');
  const c = request.data as Command;
  validateCommand(c);
  if (c.actorId !== undefined && c.actorId !== request.auth.uid)
    throw new HttpsError(
      'permission-denied',
      'This operation belongs to another signed-in account.',
    );
  try {
    if (c.kind === 'note') {
      const uid = await agent(request.auth.uid);
      if (c.scope !== `note:${c.data.noteId}` || c.data.mutationId !== c.id)
        bad('Invalid note operation.');
      return await manageNoteData(uid, c.data, c);
    }
    return await financial(request.auth.uid, c);
  } catch (error) {
    if (
      error instanceof HttpsError &&
      ['failed-precondition', 'invalid-argument', 'not-found'].includes(
        error.code,
      )
    )
      return recordRejection(request.auth.uid, c, error);
    throw error;
  }
});
export const registerReminderDevice = onCall(options, async (request) => {
  const uid = await agent(request.auth?.uid),
    { token, browserId, enabled } = request.data;
  if (
    typeof token !== 'string' ||
    token.length < 20 ||
    token.length > 4096 ||
    typeof browserId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(browserId) ||
    typeof enabled !== 'boolean'
  )
    bad('Invalid notification device.');
  const ref = db.doc(`reminderDevices/${hash(token)}`);
  await db.runTransaction(async (tx) => {
    const [old, previous] = await Promise.all([
      tx.get(ref),
      tx.get(
        db
          .collection('reminderDevices')
          .where('uid', '==', uid)
          .where('browserId', '==', browserId)
          .limit(20),
      ),
    ]);
    if (!enabled) {
      if (old.data()?.uid === uid)
        tx.set(ref, { enabled: false, updatedAt: nowStamp() }, { merge: true });
      return;
    }
    for (const d of previous.docs)
      if (d.id !== ref.id)
        tx.update(d.ref, { enabled: false, updatedAt: nowStamp() });
    tx.set(ref, {
      uid,
      token,
      browserId,
      enabled: true,
      updatedAt: nowStamp(),
    });
  });
  return { ok: true };
});
function ticket(deliveryId: string, expires: number) {
  const data = Buffer.from(
    JSON.stringify({ id: deliveryId, exp: expires }),
  ).toString('base64url');
  return (
    data +
    '.' +
    createHmac('sha256', signingKey.value()).update(data).digest('base64url')
  );
}
function readTicket(value: unknown): { id: string; exp: number } | null {
  try {
    if (typeof value !== 'string' || value.length > 1024) return null;
    const [data, signature, ...extra] = value.split('.');
    if (extra.length || !signature) return null;
    const expected = createHmac('sha256', signingKey.value())
      .update(data)
      .digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    return /^[a-f0-9]{64}$/.test(p.id) &&
      Number.isSafeInteger(p.exp) &&
      p.exp > Date.now()
      ? p
      : null;
  } catch {
    return null;
  }
}
async function validDelivery(d: FirebaseFirestore.DocumentData) {
  const [note, device, profile] = await Promise.all([
    db.doc(`users/${d.uid}/notes/${d.noteId}`).get(),
    db.doc(`reminderDevices/${d.deviceId}`).get(),
    db.doc(`users/${d.uid}`).get(),
  ]);
  const n = note.data(),
    dev = device.data(),
    p = profile.data();
  return !!(
    n &&
    dev?.enabled &&
    dev.uid === d.uid &&
    p?.active === true &&
    p.role === 'agent' &&
    n.scheduleVersion === d.scheduleVersion &&
    n.occurrenceAt === d.occurrenceAt &&
    !n.done &&
    d.expiresAt.toMillis() > Date.now()
  );
}
export const validateReminder = onRequest(
  { ...options, secrets: [signingKey], cors: false },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // HTTPS Hosting rewrite makes this same-origin; signed tickets are limited capabilities.
    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }
    const parsed = readTicket(req.body?.ticket);
    if (!parsed) {
      res.status(403).json({ valid: false });
      return;
    }
    const snap = await db.doc(`reminderDeliveries/${parsed.id}`).get(),
      d = snap.data();
    if (!d || !(await validDelivery(d))) {
      res.json({ valid: false });
      return;
    }
    res.json({
      valid: true,
      uid: d.uid,
      eventId: snap.id,
      path: `/agent/notes/?note=${encodeURIComponent(d.noteId)}`,
    });
  },
);
export const dispatchReminders = onSchedule(
  {
    ...options,
    region: 'europe-west1',
    maxInstances: 1,
    schedule: 'every 1 minutes',
    timeZone: 'Africa/Kampala',
    secrets: [signingKey],
    timeoutSeconds: 120,
  },
  async () => {
    const now = Date.now();
    const due = await db
      .collectionGroup('notes')
      .where('dueAt', '<=', Timestamp.fromMillis(now))
      .orderBy('dueAt')
      .limit(100)
      .get();
    for (const item of due.docs) {
      const uid = item.ref.parent.parent?.id;
      if (!uid || item.ref.path !== `users/${uid}/notes/${item.id}`) continue;
      const owner = (await db.doc(`users/${uid}`).get()).data();
      if (owner?.active !== true || owner.role !== 'agent') {
        await item.ref.update({ dueAt: null });
        continue;
      }
      const devices = await db
        .collection('reminderDevices')
        .where('uid', '==', uid)
        .where('enabled', '==', true)
        .limit(20)
        .get();
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(item.ref),
          n = fresh.data();
        if (!n?.dueAt || n.dueAt.toMillis() > now) return;
        const r = n.reminder as Reminder,
          occurrence = n.dueAt.toMillis();
        const expires =
          r.kind === 'weekly' ? nextWeekly(r, now) : now + 28 * 86400000;
        const skipped = n.done && n.completedOccurrence === occurrence;
        tx.update(item.ref, {
          dueAt:
            r.kind === 'weekly'
              ? Timestamp.fromMillis(nextWeekly(r, now))
              : null,
          occurrenceAt: occurrence,
          done: skipped,
          revision: (n.revision ?? 0) + 1,
          lastQueuedOccurrence: skipped
            ? (n.lastQueuedOccurrence ?? null)
            : occurrence,
        });
        if (skipped) return;
        for (const device of devices.docs) {
          const deliveryId = hash(
            `${item.ref.path}/${n.scheduleVersion}/${occurrence}/${device.id}`,
          );
          tx.create(db.doc(`reminderDeliveries/${deliveryId}`), {
            uid,
            noteId: item.id,
            deviceId: device.id,
            scheduleVersion: n.scheduleVersion,
            occurrenceAt: occurrence,
            expiresAt: Timestamp.fromMillis(expires),
            status: 'pending',
            attempts: 0,
            nextAttemptAt: nowStamp(),
            leaseUntil: Timestamp.fromMillis(0),
          });
        }
      });
    }
    const deliveries = await db
      .collection('reminderDeliveries')
      .where('status', 'in', ['pending', 'leased'])
      .where('nextAttemptAt', '<=', Timestamp.fromMillis(now))
      .orderBy('nextAttemptAt')
      .limit(100)
      .get();
    for (const item of deliveries.docs) {
      const d = await db.runTransaction(async (tx) => {
        const snap = await tx.get(item.ref),
          v = snap.data();
        if (!v) return null;
        if (v.attempts >= 5 || v.expiresAt.toMillis() <= now) {
          tx.update(item.ref, {
            status: v.attempts >= 5 ? 'failed' : 'cancelled',
          });
          return null;
        }
        if (v.leaseUntil.toMillis() > now) return null;
        tx.update(item.ref, {
          status: 'leased',
          leaseUntil: Timestamp.fromMillis(now + 180000),
          nextAttemptAt: Timestamp.fromMillis(now + 180000),
          attempts: v.attempts + 1,
        });
        return v;
      });
      if (!d) continue;
      if (!(await validDelivery(d))) {
        await item.ref.update({ status: 'cancelled' });
        continue;
      }
      const device = (
        await db.doc(`reminderDevices/${d.deviceId}`).get()
      ).data();
      try {
        await getMessaging().send({
          token: device!.token,
          data: { ticket: ticket(item.id, d.expiresAt.toMillis()), uid: d.uid },
          webpush: {
            headers: {
              TTL: String(
                Math.max(
                  0,
                  Math.min(
                    2419200,
                    Math.floor((d.expiresAt.toMillis() - Date.now()) / 1000),
                  ),
                ),
              ),
            },
          },
        });
        await item.ref.update({
          status: 'sent',
          sentAt: nowStamp(),
          leaseUntil: Timestamp.fromMillis(0),
        });
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          await db
            .doc(`reminderDevices/${d.deviceId}`)
            .update({ enabled: false });
          await item.ref.update({ status: 'cancelled' });
        } else
          await item.ref.update({
            status: d.attempts >= 4 ? 'failed' : 'pending',
            leaseUntil: Timestamp.fromMillis(0),
            nextAttemptAt: Timestamp.fromMillis(
              Date.now() + Math.min(3600000, 60000 * 2 ** d.attempts),
            ),
          });
      }
    }
  },
);
