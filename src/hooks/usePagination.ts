import { useEffect, useState } from 'react';
export const PAGE_SIZE = 50;
/** Client-side paging for grouped/cache-backed lists. Remote lists own their cursors. */
export function usePagination<T>(items: T[], key: string) {
  const [state, setState] = useState({ key, page: 1 });
  useEffect(() => {
    setState({ key, page: 1 });
  }, [key]);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = state.key === key ? Math.min(state.page, pageCount) : 1;
  const offset = (page - 1) * PAGE_SIZE;
  return {
    page,
    pageCount,
    items: items.slice(offset, offset + PAGE_SIZE),
    summary: items.length
      ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, items.length)} of ${items.length}`
      : 'No matches',
    previous: () => setState({ key, page: Math.max(1, page - 1) }),
    next: () => setState({ key, page: Math.min(pageCount, page + 1) }),
  };
}
