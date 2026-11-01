import { onIdTokenChanged } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from './firebase';
import { affectedPaths } from './command-state';
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from 'firebase/functions';
import { auth } from './firebase';
import {
  changeLocal,
  durableStorageAvailable,
  localOwner,
  namespace,
  localState,
  reconcile,
  unpack,
} from './local';
import { project, visible } from './projection';
import type { Command, Outcome, Kind } from '../../functions/src/protocol';
let service: ReturnType<typeof getFunctions>;
function api() {
  if (!service) {
    service = getFunctions(auth.app, 'africa-south1');
    if (import.meta.env.PUBLIC_USE_EMULATORS === 'true')
      connectFunctionsEmulator(service, '127.0.0.1', 5001);
  }
  return service;
}
export async function enqueue(
  kind: Kind,
  scope: string,
  data: Record<string, any>,
  id: string = crypto.randomUUID(),
) {
  if (!durableStorageAvailable())
    throw new Error(
      'Device storage is unavailable. Enable site storage before saving offline work.',
    );
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in before saving.');
  if (localOwner() !== namespace(uid, String(auth.app.options.projectId)))
    throw new Error('Your account changed. Reopen the app before saving.');
  const started = performance.now();
  await changeLocal((s) => {
    const existing = s.commands.find((p) => p.command.id === id);
    if (existing) {
      if (JSON.stringify(existing.command.data) !== JSON.stringify(data))
        throw new Error(
          'This save reference belongs to another change. Review it first.',
        );
      return;
    }
    if (s.receipts[id]) return;
    const previous = s.commands.filter((p) => p.command.scope === scope).at(-1);
    if (previous?.state === 'attention')
      throw new Error('Resolve the pending change for this record first.');
    const command: Command = {
      version: 1,
      actorId: uid,
      id,
      deviceId: deviceId(),
      capturedAt: Date.now(),
      sequence: ++s.sequence,
      kind,
      scope,
      dependsOn: previous?.command.id ?? null,
      data,
    };
    project(visible(s.records, s.commands, uid), command, uid);
    s.commands.push({ command, state: 'pending', error: '' });
    if (kind === 'note' && data.action === 'save') {
      if (data.expectedRevision === 0) {
        s.drafts = { ...s.drafts, noteComposer: {} };
        if (s.drafts.collection) s.drafts.collection.noteDraft = '';
      } else if (s.drafts?.noteEdit?.noteId === data.noteId)
        delete s.drafts!.noteEdit;
    }
    if (kind === 'entry' && s.drafts?.collection)
      s.drafts.collection = { noteDraft: s.drafts.collection.noteDraft ?? '' };
  });
  performance.measure('lct.local-save', {
    start: started,
    end: performance.now(),
  });
  if (performance.getEntriesByName('lct.local-save').length > 100)
    performance.clearMeasures('lct.local-save');
  void flush();
  return id;
}
function deviceId() {
  let id: string | null = null;
  try {
    id = localStorage.getItem('lct-device-id');
  } catch {}
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem('lct-device-id', id);
    } catch {}
  }
  return id;
}
let running = false,
  stopped = false,
  accessPaused = false,
  failures = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
export function startSync() {
  stopped = false;
  accessPaused = false;
  const stopToken = onIdTokenChanged(auth, () => {
    accessPaused = false;
    void flush();
  });
  void flush();
  const resume = () => {
    failures = 0;
    void flush();
  };
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  const poll = setInterval(() => void flush(), 15000);
  return () => {
    stopped = true;
    stopToken();
    clearTimeout(timer);
    clearInterval(poll);
    window.removeEventListener('online', resume);
    window.removeEventListener('focus', resume);
  };
}
export async function flush(force = false) {
  if (force) accessPaused = false;
  if (
    accessPaused ||
    running ||
    stopped ||
    !navigator.onLine ||
    !localOwner() ||
    !auth.currentUser ||
    localOwner() !==
      namespace(auth.currentUser.uid, String(auth.app.options.projectId))
  )
    return;
  running = true;
  const owner = localOwner(),
    uid = auth.currentUser.uid;
  let didRun = false;
  const run = async () => {
    didRun = true;
    const blocked = new Set<string>();
    for (const item of [...localState().commands]) {
      if (stopped || owner !== localOwner() || uid !== auth.currentUser?.uid)
        break;
      const c = item.command;
      if (item.state === 'attention') {
        blocked.add(c.scope);
        continue;
      }
      if (blocked.has(c.scope)) continue;
      try {
        await changeLocal((s) => {
          const p = s.commands.find((p) => p.command.id === c.id);
          if (p) p.state = 'syncing';
        }, owner);
        const result = await httpsCallable<Command, Outcome>(
          api(),
          'syncOperation',
          { timeout: 20000 },
        )(c);
        if (owner !== localOwner()) break;
        await changeLocal((s) => {
          const outcome = unpack(result.data);
          if (outcome.status === 'rejected') {
            s.receipts[c.id] = outcome;
            const p = s.commands.find((p) => p.command.id === c.id);
            if (p) {
              p.state = 'attention';
              p.error = outcome.message ?? 'Review this change.';
            }
            blocked.add(c.scope);
            return;
          }
          reconcile(s, outcome.records);
          s.receipts[c.id] = outcome;
          s.commands = s.commands.filter((p) => p.command.id !== c.id);
        }, owner);
        if (result.data.status === 'rejected') await refreshCommand(c, owner);
        failures = 0;
      } catch (error: any) {
        if (owner !== localOwner()) break;
        if (
          ['functions/unauthenticated', 'functions/permission-denied'].includes(
            error.code,
          )
        ) {
          accessPaused = true;
          await changeLocal((s) => {
            const p = s.commands.find((p) => p.command.id === c.id);
            if (p) {
              p.state = 'pending';
              p.error =
                'Sign in again or contact the owner to restore access. Your change remains on this device.';
            }
          }, owner);
          break;
        }
        const permanent = [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/not-found',
          'functions/permission-denied',
        ].includes(error.code);
        await changeLocal((s) => {
          const p = s.commands.find((p) => p.command.id === c.id);
          if (p) {
            p.state = permanent ? 'attention' : 'pending';
            p.error = error.message ?? 'Could not connect.';
          }
        }, owner);
        if (permanent) {
          blocked.add(c.scope);
          continue;
        }
        failures++;
        timer = setTimeout(
          () => void flush(),
          Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) +
            Math.random() * 500,
        );
        break;
      }
    }
  };
  try {
    if (navigator.locks)
      await navigator.locks.request(
        `lct-sync:${owner}`,
        { ifAvailable: true },
        (lock) => (lock ? run() : Promise.resolve()),
      );
    else await run();
  } catch {
    // Storage or account changes retain the queued payload; the next foreground resumes.
  } finally {
    running = false;
    const s = localState();
    if (
      didRun &&
      !stopped &&
      !accessPaused &&
      failures === 0 &&
      s.commands.some(
        (p) =>
          p.state === 'pending' &&
          !s.commands.some(
            (a) =>
              a.state === 'attention' && a.command.scope === p.command.scope,
          ),
      )
    )
      timer = setTimeout(() => void flush(), 100);
  }
}
export function exportPending() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          project: auth.app.options.projectId,
          uid: auth.currentUser?.uid,
          commands: localState().commands,
          resolved: localState().resolved ?? [],
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'lct-unsynced-recovery.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refreshCommand(c: Command, owner = localOwner()) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in again.');
  const records = await Promise.all(
    affectedPaths(c, uid).map(async (path) => {
      const snap = await getDocFromServer(doc(db(), path));
      return [path, snap.exists() ? snap.data() : null] as const;
    }),
  );
  await changeLocal((s) => reconcile(s, Object.fromEntries(records)), owner);
}
export async function resolveCommand(
  id: string,
  reviewedData?: Record<string, any>,
) {
  const owner = localOwner(),
    p = localState().commands.find((p) => p.command.id === id);
  if (!p || p.state !== 'attention') return;
  if (localState().receipts[id]?.status !== 'rejected') {
    await changeLocal((s) => {
      const p = s.commands.find((p) => p.command.id === id);
      if (p) p.state = 'pending';
    }, owner);
    void flush();
    return;
  }
  await refreshCommand(p.command, owner);
  const pScope = p.command.scope;
  const uid = auth.currentUser!.uid;
  await changeLocal((s) => {
    const affected = s.commands.filter((p) => p.command.scope === pScope),
      map = new Map<string, string>();
    s.resolved = [
      ...(s.resolved ?? []),
      ...structuredClone(
        affected.map((p) => ({
          command: JSON.parse(JSON.stringify(p.command)),
          state: p.state,
          error: p.error,
        })),
      ),
    ];
    for (const pending of affected) {
      const old = pending.command,
        nextId = crypto.randomUUID(),
        data = { ...(old.id === id && reviewedData ? reviewedData : old.data) };
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
      const command: Command = {
        ...old,
        id: nextId,
        supersedes: old.id,
        sequence: ++s.sequence,
        dependsOn:
          old.id === id ? null : (map.get(old.dependsOn ?? '') ?? null),
        data,
      };
      map.set(old.id, nextId);

      pending.command = command;
      pending.state = 'pending';
      pending.error = '';
    }
  }, owner);
  void flush();
}

export async function prepareRetry(id: string) {
  const p = localState().commands.find((p) => p.command.id === id);
  if (!p) throw new Error('This change is no longer pending.');
  await refreshCommand(p.command);
  const data = { ...p.command.data };
  if (p.command.kind === 'entry') {
    const snap = await getDocFromServer(
      doc(db(), 'members', data.member.memberId),
    );
    if (!snap.exists() || !snap.data().active)
      throw new Error(
        'This account is no longer available. Contact the office; export the original change for recovery.',
      );
    data.member = snap.data();
  }
  if (p.command.kind === 'session')
    data.openingCash =
      localState().records[`sessions/${data.sessionId}`]?.openingCash ??
      data.openingCash;
  return data;
}
