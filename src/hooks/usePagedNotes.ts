import { useEffect, useRef, useState } from 'react';
import {
  collection,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { message } from '../lib/errors';
import type { AgentNote } from '../lib/models';
import { PAGE_SIZE } from './usePagination';
export function usePagedNotes(uid: string, enabled: boolean) {
  const cursors = useRef<() => QueryDocumentSnapshot | null>(() => null);
  const key = `${uid}/${enabled}`;
  const [paging, setPaging] = useState<{
    key: string;
    cursors: (QueryDocumentSnapshot | null)[];
    page: number;
  }>({ key, cursors: [null], page: 0 });
  const current =
    paging.key === key ? paging : { key, cursors: [null], page: 0 };
  const [result, setResult] = useState<{
    key: string;
    data: AgentNote[];
    cached: boolean;
    loading: boolean;
    hasNext: boolean;
    error: string;
  }>({
    key: '',
    data: [],
    cached: true,
    loading: true,
    hasNext: false,
    error: '',
  });
  const resultKey = `${key}/${current.page}`;
  const cursor = current.cursors[current.page];
  useEffect(() => {
    setResult({
      key: resultKey,
      data: [],
      cached: true,
      loading: enabled,
      hasNext: false,
      error: '',
    });
    if (!enabled || !uid) return;
    let stopProbe: (() => void) | undefined,
      probeKey = '';
    let last: QueryDocumentSnapshot | null = null;
    const base = query(
      collection(db(), 'users', uid, 'notes'),
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
    );
    const fail = (e: unknown) =>
      setResult((r) => ({ ...r, loading: false, error: message(e) }));
    const stop = onSnapshot(
      query(base, ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE)),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const data = snap.docs.map((d) => d.data() as AgentNote);
        last = snap.docs.at(-1) ?? null;
        const nextKey = snap.size === PAGE_SIZE && last ? last.id : '';
        setResult((r) => ({
          key: resultKey,
          data,
          cached: snap.metadata.fromCache,
          loading: false,
          error: '',
          hasNext: nextKey && probeKey === nextKey ? r.hasNext : false,
        }));
        if (probeKey === nextKey) return;
        stopProbe?.();
        probeKey = nextKey;
        if (nextKey && last)
          stopProbe = onSnapshot(
            query(base, startAfter(last), limit(1)),
            (following) =>
              setResult((r) =>
                r.key === resultKey ? { ...r, hasNext: !following.empty } : r,
              ),
            fail,
          );
      },
      fail,
    );
    // The next cursor is always the last document of the current confirmed page.
    const readLast = () => last;
    cursors.current = readLast;
    return () => {
      stop();
      stopProbe?.();
    };
  }, [resultKey, cursor]);
  const visible =
    result.key === resultKey
      ? result
      : { data: [], cached: true, loading: enabled, hasNext: false, error: '' };
  return {
    ...visible,
    page: current.page + 1,
    previous: () =>
      setPaging({ ...current, page: Math.max(0, current.page - 1) }),
    next: () => {
      const last = cursors.current();
      if (!visible.hasNext || !last) return;
      setPaging({
        key,
        cursors: [...current.cursors.slice(0, current.page + 1), last],
        page: current.page + 1,
      });
    },
  };
}
