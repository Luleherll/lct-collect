import { useEffect, useState } from 'react';
import {
  collection,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { message } from '../lib/errors';
import type { Entry } from '../lib/models';

export const ENTRY_PAGE_SIZE = 50;
/** Fixed document cursors keep recording/status changes from shifting page boundaries. */
export function usePagedEntries(
  day: string,
  identity: string,
  enabled: boolean,
) {
  const key = `${identity}/${day}`;
  const [paging, setPaging] = useState<{
    key: string;
    cursors: (QueryDocumentSnapshot | null)[];
    page: number;
  }>({ key, cursors: [null], page: 0 });
  useEffect(() => {
    setPaging({ key, cursors: [null], page: 0 });
  }, [key]);
  const current =
    paging.key === key ? paging : { key, cursors: [null], page: 0 };
  const cursor = current.cursors[current.page];
  const resultKey = `${key}/${current.page}`;
  const [result, setResult] = useState<{
    key: string;
    data: Entry[];
    loading: boolean;
    cached: boolean;
    error: string;
    last: QueryDocumentSnapshot | null;
  }>({ key: '', data: [], loading: true, cached: true, error: '', last: null });
  useEffect(() => {
    setResult({
      key: resultKey,
      data: [],
      loading: enabled,
      cached: true,
      error: '',
      last: null,
    });
    if (!enabled) return;
    return onSnapshot(
      query(
        collection(db(), 'entries'),
        where('workday', '==', day),
        orderBy('createdAt', 'desc'),
        orderBy(documentId(), 'desc'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(ENTRY_PAGE_SIZE),
      ),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        setResult({
          key: resultKey,
          data: snap.docs.map((d) => d.data() as Entry),
          loading: false,
          cached: snap.metadata.fromCache,
          error: '',
          last: snap.docs.at(-1) ?? null,
        });
      },
      (e) =>
        setResult({
          key: resultKey,
          data: [],
          loading: false,
          cached: true,
          error: message(e),
          last: null,
        }),
    );
  }, [resultKey, enabled]);
  const visible =
    result.key === resultKey
      ? result
      : { data: [], loading: enabled, cached: true, error: '', last: null };
  return {
    ...visible,
    page: current.page,
    hasNext: visible.data.length === ENTRY_PAGE_SIZE,
    previous: () =>
      setPaging({ ...current, page: Math.max(0, current.page - 1) }),
    next: () => {
      if (
        visible.loading ||
        !visible.last ||
        visible.data.length !== ENTRY_PAGE_SIZE
      )
        return;
      setPaging({
        key,
        cursors: [...current.cursors.slice(0, current.page + 1), visible.last],
        page: current.page + 1,
      });
    },
  };
}
