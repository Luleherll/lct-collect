import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  collection,
  onSnapshot,
  query,
  type QueryConstraint,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  changeLocal,
  localOwner,
  localState,
  mergeServerScope,
  snapshot,
  subscribe,
  type LocalState,
} from '../lib/local';
import { visible } from '../lib/projection';
import { message } from '../lib/errors';
export function useLocalVersion() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export interface LocalView<T> {
  matches?: (record: T) => boolean;
  compare?: (a: T, b: T) => number;
  limit?: number;
}
/** A full, server-authoritative snapshot establishes completeness for exactly one scope. */
export function storeScope(
  s: LocalState,
  scope: string,
  records: Record<string, any>,
  removeMissing = true,
) {
  mergeServerScope(
    s,
    scope,
    records,
    auth.currentUser?.uid ?? '',
    removeMissing,
  );
}
export function useLocalRecords<T>(
  name: string,
  constraints: QueryConstraint[],
  key: string,
  enabled: boolean,
  view: LocalView<T> = {},
) {
  const version = useLocalVersion(),
    owner = localOwner(),
    scope = `${name}:${key}`;
  const [remote, setRemote] = useState({
    scope: '',
    owner: '',
    error: '',
    cached: true,
    waiting: true,
  });
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    if (!enabled || !owner) return;
    let active = true;
    setRemote({ scope, owner, error: '', cached: true, waiting: true });
    const timer = setTimeout(() => {
      if (active) setRemote((r) => ({ ...r, waiting: false }));
    }, 10000);
    const stop = onSnapshot(
      query(collection(db(), name), ...constraints),
      { includeMetadataChanges: true },
      (snap) => {
        if (
          !active ||
          snap.metadata.fromCache ||
          snap.metadata.hasPendingWrites
        )
          return;
        const records = Object.fromEntries(
          snap.docs.map((d) => [d.ref.path, d.data()]),
        );
        void changeLocal((s) => storeScope(s, scope, records, true), owner)
          .then(() => {
            if (active)
              setRemote({
                scope,
                owner,
                error: '',
                cached: false,
                waiting: false,
              });
          })
          .catch((e) => {
            if (active)
              setRemote({
                scope,
                owner,
                error: message(e),
                cached: true,
                waiting: false,
              });
          });
      },
      (e) => {
        if (active)
          setRemote({
            scope,
            owner,
            error: message(e),
            cached: true,
            waiting: false,
          });
      },
    );
    return () => {
      active = false;
      clearTimeout(timer);
      stop();
    };
  }, [scope, enabled, owner]);
  // The explicit query key represents the day, role and filters used by the view.
  const projected = useMemo(
    () =>
      visible(
        localState().records,
        localState().commands,
        auth.currentUser?.uid ?? '',
      ),
    [version],
  );
  const state = localState(),
    complete = Object.hasOwn(state.scopes, scope);
  const data = useMemo(() => {
    let data = enabled
      ? Object.entries(projected).flatMap(([path, record]) =>
          path.startsWith(name + '/') &&
          !path.slice(name.length + 1).includes('/') &&
          (!view.matches || view.matches(record))
            ? [record as T]
            : [],
        )
      : [];
    if (view.compare) data.sort(view.compare);
    if (view.limit) data = data.slice(0, view.limit);
    return data;
  }, [projected, name, scope, enabled]);
  const currentRemote = remote.scope === scope && remote.owner === owner;
  return {
    data,
    loading:
      enabled &&
      !complete &&
      !data.length &&
      online &&
      (!currentRemote || remote.waiting),
    cached: !currentRemote || remote.cached,
    error: currentRemote ? remote.error : '',
    complete,
    unavailable:
      enabled &&
      !complete &&
      !data.length &&
      (!online || (currentRemote && !remote.waiting)),
  };
}
