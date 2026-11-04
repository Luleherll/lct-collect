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
  acknowledge,
  mergeServerRecords,
  releaseHeldRecords,
  unpack,
} from './local';
import { project, visible } from './projection';
import {
  archivePaths,
  rejectedVoidScope,
  planVoidArchive,
  applyVoidArchive,
  requeueReviewed,
  type ArchiveReview,
} from './queue-review';
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
let reviewing = false;
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
    reviewing ||
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
      if (
        reviewing ||
        stopped ||
        owner !== localOwner() ||
        uid !== auth.currentUser?.uid
      )
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
          acknowledge(s, c.id, unpack(result.data), uid);
          if (result.data.status === 'rejected') blocked.add(c.scope);
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
          if (permanent) releaseHeldRecords(s, uid);
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
  await changeLocal(
    (s) => mergeServerRecords(s, Object.fromEntries(records), uid),
    owner,
  );
}
async function reviewLock<T>(run: (owner: string, uid: string) => Promise<T>) {
  const owner = localOwner(),
    uid = auth.currentUser?.uid;
  if (!uid || owner !== namespace(uid, String(auth.app.options.projectId)))
    throw new Error('Account changed. Sign in again.');
  if (reviewing) throw new Error('A review is already in progress.');
  if (!navigator.locks && running)
    throw new Error('Sync is running. Wait a moment and review again.');
  reviewing = true;
  try {
    const guarded = async () => {
      if (owner !== localOwner() || uid !== auth.currentUser?.uid)
        throw new Error('Account changed. Reopen the review.');
      return run(owner, uid);
    };
    return navigator.locks
      ? await navigator.locks.request(`lct-sync:${owner}`, guarded)
      : await guarded();
  } finally {
    reviewing = false;
    void flush();
  }
}
export async function resolveCommand(
  id: string,
  reviewedData?: Record<string, any>,
) {
  await reviewLock(async (owner, uid) => {
    const p = localState().commands.find((p) => p.command.id === id);
    if (!p || p.state !== 'attention') return;
    if (localState().receipts[id]?.status !== 'rejected' && !p.requiresReview) {
      await changeLocal((s) => {
        const pending = s.commands.find((p) => p.command.id === id);
        if (pending) pending.state = 'pending';
      }, owner);
      return;
    }
    await refreshCommand(p.command, owner);
    await changeLocal((s) => requeueReviewed(s, id, uid, reviewedData), owner);
  });
  void flush();
}
async function refreshArchive(id: string, owner: string, uid: string) {
  const items = rejectedVoidScope(localState(), id, uid);
  const before = JSON.stringify(items);
  const records = await Promise.all(
    archivePaths(items, uid).map(async (path) => {
      try {
        const snap = await getDocFromServer(doc(db(), path));
        return [path, snap.exists() ? snap.data() : null] as const;
      } catch (error: any) {
        if (
          path.startsWith('members/') &&
          ['permission-denied', 'not-found'].includes(error.code)
        )
          return [path, null] as const;
        throw error;
      }
    }),
  );
  await changeLocal((s) => {
    if (JSON.stringify(rejectedVoidScope(s, id, uid)) !== before)
      throw new Error('Later work changed. Refresh the archive review.');
    mergeServerRecords(s, Object.fromEntries(records), uid);
  }, owner);
  return planVoidArchive(localState(), id, uid);
}
export async function prepareVoidArchive(id: string): Promise<ArchiveReview> {
  return reviewLock((owner, uid) => refreshArchive(id, owner, uid));
}
export async function archiveRejectedVoid(review: ArchiveReview) {
  await reviewLock(async (owner, uid) => {
    await refreshArchive(review.id, owner, uid);
    await changeLocal((s) => applyVoidArchive(s, review, uid), owner);
  });
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
