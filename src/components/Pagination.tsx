import { useEffect, useRef } from 'react';
export default function Pagination({
  label,
  page,
  pageCount,
  summary,
  hasPrevious = page > 1,
  hasNext = pageCount !== undefined && page < pageCount,
  onPrevious,
  onNext,
  busy = false,
  focusTarget,
}: {
  label: string;
  page: number;
  pageCount?: number;
  summary?: string;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  busy?: boolean;
  focusTarget?: string;
}) {
  const requestedPage = useRef<number | null>(null);
  useEffect(() => {
    if (
      busy ||
      requestedPage.current === null ||
      page === requestedPage.current
    )
      return;
    requestedPage.current = null;
    if (!focusTarget) return;
    const target = document.getElementById(focusTarget);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [page, busy, focusTarget]);
  function navigate(run: () => void) {
    requestedPage.current = page;
    run();
  }
  return (
    <nav className="pagination" aria-label={label}>
      <button
        className="button outline small"
        disabled={busy || !hasPrevious}
        onClick={() => navigate(onPrevious)}
      >
        Previous
      </button>
      <span role="status">
        {summary && <>{summary} · </>}Page {page}
        {pageCount !== undefined && <> of {pageCount}</>}
      </span>
      <button
        className="button outline small"
        disabled={busy || !hasNext}
        onClick={() => navigate(onNext)}
      >
        Next
      </button>
    </nav>
  );
}
