import { useEffect, useState } from 'react';
import {
  collection,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { message } from '../lib/errors';
import { flatten, type Entry, type Row } from '../lib/models';
import { PAGE_SIZE } from './usePagination';
export const ENTRY_PAGE_SIZE = PAGE_SIZE;
type Cursor = { doc: QueryDocumentSnapshot; skip: number } | null;
type Result = {
  key: string;
  data: Entry[];
  rows: Row[];
  loading: boolean;
  cached: boolean;
  error: string;
  nextCursor: Cursor;
  hasNext: boolean;
};
const empty = (key: string, loading: boolean): Result => ({
  key,
  data: [],
  rows: [],
  loading,
  cached: true,
  error: '',
  nextCursor: null,
  hasNext: false,
});
/** A page contains at most 50 lines and fetches at most 50 entry documents.
 * An ambiguous full batch uses a separate one-document live lookahead.
 * A cursor can resume within a multi-line entry, so its other lines are never lost.
 * Recording/voiding does not change the immutable line keys or page boundaries. */
export function usePagedEntries(
  day: string,
  identity: string,
  enabled: boolean,
  agentId?: string,
) {
  const key = `${identity}/${day}`;
  const [paging, setPaging] = useState<{
    key: string;
    cursors: Cursor[];
    page: number;
  }>({ key, cursors: [null], page: 0 });
  useEffect(() => {
    setPaging({ key, cursors: [null], page: 0 });
  }, [key]);
  const current =
    paging.key === key ? paging : { key, cursors: [null], page: 0 };
  const cursor = current.cursors[current.page];
  const resultKey = `${key}/${current.page}`;
  const [result, setResult] = useState<Result>(empty('', true));
  useEffect(() => {
    setResult(empty(resultKey, enabled));
    if (!enabled) return;
    let stopLookahead: (() => void) | undefined;
    let lookaheadKey = '';
    let followingExists = false;
    const base = query(
      collection(db(), 'entries'),
      where('workday', '==', day),
      ...(agentId ? [where('agentId', '==', agentId)] : []),
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
    );
    const stopPage = onSnapshot(
      query(
        base,
        ...(cursor
          ? [cursor.skip ? startAt(cursor.doc) : startAfter(cursor.doc)]
          : []),
        limit(PAGE_SIZE),
      ),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const available = snap.docs.flatMap((doc, i) =>
          flatten([doc.data() as Entry])
            .map((row, index) => ({ row, doc, consumed: index + 1 }))
            .slice(i === 0 ? (cursor?.skip ?? 0) : 0),
        );
        const visible = available.slice(0, PAGE_SIZE);
        const last = visible.at(-1);
        const nextCursor = last
          ? {
              doc: last.doc,
              skip:
                last.consumed < flatten([last.doc.data() as Entry]).length
                  ? last.consumed
                  : 0,
            }
          : null;
        const page: Result = {
          key: resultKey,
          rows: visible.map((v) => v.row),
          data: Array.from(
            new Map(
              visible.map((v) => [v.row.entry.entryId, v.row.entry]),
            ).values(),
          ),
          loading: false,
          cached: snap.metadata.fromCache,
          error: '',
          nextCursor,
          hasNext: available.length > PAGE_SIZE,
        };
        const boundary =
          last && !page.hasNext && snap.docs.length === PAGE_SIZE
            ? last.doc.ref.path
            : '';
        if (boundary !== lookaheadKey) {
          stopLookahead?.();
          stopLookahead = undefined;
          lookaheadKey = boundary;
          followingExists = false;
        }
        if (boundary) page.hasNext = followingExists;
        setResult(page);
        // A full batch alone does not prove that another entry exists. Keep
        // Next disabled until the lookahead confirms it; listen so additions
        // and deletions beyond this page update the control in real time.
        if (last && boundary && !stopLookahead) {
          stopLookahead = onSnapshot(
            query(base, startAfter(last.doc), limit(1)),
            { includeMetadataChanges: true },
            (following) => {
              if (
                following.metadata.hasPendingWrites ||
                lookaheadKey !== boundary
              )
                return;
              followingExists = !following.empty;
              setResult((current) => ({
                ...current,
                hasNext: followingExists,
              }));
            },
            (e) => {
              if (lookaheadKey !== boundary) return;
              setResult((current) => ({
                ...current,
                hasNext: false,
                error: message(e),
              }));
            },
          );
        }
      },
      (e) => {
        stopLookahead?.();
        setResult({ ...empty(resultKey, false), error: message(e) });
      },
    );
    return () => {
      stopPage();
      stopLookahead?.();
    };
  }, [resultKey, enabled]);
  const visible = result.key === resultKey ? result : empty(resultKey, enabled);
  return {
    ...visible,
    page: current.page,
    previous: () =>
      setPaging({ ...current, page: Math.max(0, current.page - 1) }),
    next: () => {
      if (visible.loading || !visible.nextCursor || !visible.hasNext) return;
      setPaging({
        key,
        cursors: [
          ...current.cursors.slice(0, current.page + 1),
          visible.nextCursor,
        ],
        page: current.page + 1,
      });
    },
  };
}
