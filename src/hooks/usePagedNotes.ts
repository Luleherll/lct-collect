import { orderBy } from 'firebase/firestore';
import { useLocalRecords } from './useLocal';
import { usePagination } from './usePagination';
import type { AgentNote } from '../lib/models';
export function usePagedNotes(uid: string, enabled: boolean) {
  const result = useLocalRecords<AgentNote>(
    `users/${uid}/notes`,
    [orderBy('createdAt', 'desc')],
    uid,
    enabled,
  );
  const data = [...result.data].sort(
    (a, b) =>
      (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0) ||
      b.noteId.localeCompare(a.noteId),
  );
  const page = usePagination(data, uid);
  return {
    ...result,
    data: page.items,
    page: page.page,
    previous: page.previous,
    next: page.next,
    hasNext: page.page < page.pageCount,
  };
}
