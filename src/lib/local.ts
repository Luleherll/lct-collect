import { affectedPaths } from './command-state';
import { Timestamp } from 'firebase/firestore';
import type { Command, Outcome } from '../../functions/src/protocol';
export interface Pending {
  command: Command;
  state: 'pending' | 'syncing' | 'attention';
  error: string;
}
export interface LocalState {
  resolved?: Pending[];
  drafts?: Record<string, any>;
  records: Record<string, any>;
  scopes: Record<string, string[]>;
  commands: Pending[];
  receipts: Record<string, Outcome>;
  sequence: number;
}
const empty = (): LocalState => ({
  records: {},
  scopes: {},
  commands: [],
  receipts: {},
  sequence: 0,
});
export function pack(v: any): any {
  if (v instanceof Timestamp) return { __timestamp: v.toMillis() };
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, pack(v)]),
    );
  return v;
}
export function unpack(v: any): any {
  if (
    v &&
    typeof v === 'object' &&
    Object.keys(v).length === 1 &&
    typeof v.__timestamp === 'number'
  )
    return Timestamp.fromMillis(v.__timestamp);
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v).map(([k, v]) => [k, unpack(v)]),
    );
  return v;
}
let database: Promise<IDBDatabase> | undefined;
function databaseOpen() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('lct-local-first-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('users');
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(
        new Error(
          'Device storage is unavailable. Keep your form open and enable site storage.',
        ),
      );
    };
    request.onblocked = () =>
      reject(new Error('Close older LCT tabs to upgrade device storage.'));
  }));
}
let memoryOnly = false;
export const durableStorageAvailable = () => !memoryOnly;
let owner = '',
  current = empty(),
  version = 0;
const listeners = new Set<() => void>();
const channel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('lct-local-first')
    : null;
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const snapshot = () => version;
export const localState = () => current;
export const localOwner = () => owner;
function emit() {
  version++;
  listeners.forEach((fn) => fn());
}
export function namespace(uid: string, project: string) {
  return `${project}/${uid}`;
}
export async function openLocal(uid: string, project: string) {
  const key = namespace(uid, project);
  owner = key;
  current = empty();
  emit();
  memoryOnly = false;
  let db: IDBDatabase;
  try {
    db = await databaseOpen();
  } catch {
    if (owner === key) {
      memoryOnly = true;
      emit();
    }
    return;
  }
  const state = await new Promise<LocalState>((resolve, reject) => {
    const r = db.transaction('users').objectStore('users').get(key);
    r.onsuccess = () => resolve(unpack(r.result) ?? empty());
    r.onerror = () => reject(r.error);
  });
  if (owner === key) {
    void globalThis.navigator?.storage?.persist?.().catch(() => false);
    current = state;
    emit();
  }
}
export function closeLocal() {
  owner = '';
  current = empty();
  emit();
}
export async function changeLocal(
  fn: (s: LocalState) => void,
  expectedOwner = owner,
) {
  if (!expectedOwner || owner !== expectedOwner)
    throw new Error('Sign in again before saving.');
  if (memoryOnly) {
    fn(current);
    emit();
    return;
  }
  const db = await databaseOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite'),
      store = tx.objectStore('users'),
      r = store.get(expectedOwner);
    let next: LocalState;
    r.onsuccess = () => {
      try {
        if (owner !== expectedOwner) throw new Error('Account changed.');
        next = unpack(r.result) ?? empty();
        fn(next);
        store.put(pack(next), expectedOwner);
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => {
      if (owner === expectedOwner) {
        current = next;
        emit();
      }
      channel?.postMessage(expectedOwner);
      resolve();
    };
    tx.onabort = () =>
      reject(
        tx.error ??
          new Error(
            'Could not save on this device. Keep your form open; free storage and retry.',
          ),
      );
    tx.onerror = () => {};
  });
}
channel?.addEventListener('message', async (e) => {
  if (e.data !== owner || !owner) return;
  const key = owner,
    db = await databaseOpen();
  const r = db.transaction('users').objectStore('users').get(key);
  r.onsuccess = () => {
    if (owner === key) {
      current = unpack(r.result) ?? empty();
      emit();
    }
  };
});
export async function clearLocal() {
  if (memoryOnly) {
    closeLocal();
    return;
  }
  const key = owner,
    db = await databaseOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    const store = tx.objectStore('users'),
      r = store.get(key);
    r.onsuccess = () => {
      const state = unpack(r.result) as LocalState | undefined;
      if (state?.commands.length) {
        tx.abort();
        return;
      }
      store.delete(key);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        tx.error ??
          new Error(
            'Unsynced work remains. Keep it on this device or export it before clearing data.',
          ),
      );
  });
  closeLocal();
  channel?.postMessage(key);
}
export function reconcile(s: LocalState, records: Record<string, any | null>) {
  for (const [path, value] of Object.entries(records)) {
    const old = s.records[path];
    // Older receipts must not roll back a newer live snapshot.
    const rev = (v: any) =>
      path.startsWith('sessions/')
        ? (v?.revision ?? 0)
        : path.startsWith('entries/')
          ? [
              v?.financialRevision ?? 0,
              ...Object.values(v?.lines ?? {}).map(
                (l: any) => l.recordingRevision ?? 0,
              ),
            ].reduce((a, b) => a + b, 0)
          : (v?.revision ?? 0);
    if (value === null) delete s.records[path];
    else if (!old || rev(value) === undefined || rev(value) >= rev(old))
      s.records[path] = value;
  }
}

/** Hold live changes touched by local commands until their atomic server receipt. */
export function mergeServerScope(
  s: LocalState,
  scope: string,
  records: Record<string, any>,
  uid: string,
  removeMissing = true,
) {
  const held = new Set(
    s.commands
      .filter((p) => p.state !== 'attention')
      .flatMap((p) => affectedPaths(p.command, uid)),
  );
  if (removeMissing)
    for (const path of s.scopes[scope] ?? [])
      if (!(path in records) && !held.has(path)) delete s.records[path];
  reconcile(
    s,
    Object.fromEntries(
      Object.entries(records).filter(([path]) => !held.has(path)),
    ),
  );
  s.scopes[scope] = Object.keys(records);
}
