import { orderBy, where } from 'firebase/firestore';
import { useLocalRecords } from './useLocal';
import { PAGE_SIZE } from './usePagination';
import { flatten, type Entry } from '../lib/models';
export const ENTRY_PAGE_SIZE = PAGE_SIZE;
export function usePagedEntries(
  day: string,
  identity: string,
  enabled: boolean,
  agentId?: string,
) {
  const result = useLocalRecords<Entry>(
    'entries',
    [
      where('workday', '==', day),
      ...(agentId ? [where('agentId', '==', agentId)] : []),
      orderBy('createdAt', 'desc'),
    ],
    `${identity}/${day}`,
    enabled,
    {
      matches: (e) => e.workday === day && (!agentId || e.agentId === agentId),
    },
  );
  const data = result.data
    .filter((e) => e.workday === day && (!agentId || e.agentId === agentId))
    .sort(
      (a, b) =>
        (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0) ||
        b.entryId.localeCompare(a.entryId),
    );
  return { ...result, data, rows: flatten(data) };
}
