import { orderBy } from 'firebase/firestore';
import { useLocalRecords } from './useLocal';
import { useMemo } from 'react';
import type { AgentNote } from '../lib/models';
export function usePagedNotes(uid: string, enabled: boolean) {
  const result = useLocalRecords<AgentNote>(
    `users/${uid}/notes`,
    [orderBy('createdAt', 'desc')],
    uid,
    enabled,
  );
  // The agenda filters/sorts the complete local list before presenting 50-note pages.
  const data = useMemo(
    () =>
      [...result.data].sort(
        (a, b) =>
          (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0) ||
          b.noteId.localeCompare(a.noteId),
      ),
    [result.data],
  );
  return {
    ...result,
    data,
  };
}
