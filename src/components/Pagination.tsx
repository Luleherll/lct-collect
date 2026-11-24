import { useEffect, useRef } from 'react';
export default function Pagination({
  label,
  page,
  pageCount,
  summary,
  hasPrevious = page > 1,
  hasNext = pageCount !== undefined && page < pageCount,
  onPageChange,
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
  onPageChange?: (page: number) => void;
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
        type="button"
        className="button outline small"
        disabled={busy || !hasPrevious}
        onClick={() => navigate(onPrevious)}
      >
        Previous
      </button>
      {pageCount !== undefined && onPageChange && (
        <div className="page-numbers" aria-label="Page numbers">
          {Array.from(
            new Set(
              (pageCount <= 5
                ? Array.from({ length: pageCount }, (_, i) => i + 1)
                : [1, page - 1, page, page + 1, pageCount]
              ).filter((n) => n >= 1 && n <= pageCount),
            ),
          )
            .sort((a, b) => a - b)
            .flatMap((n, i, all) => [
              ...(i && n - all[i - 1] > 1
                ? [
                    <span aria-hidden="true" key={'gap' + n}>
                      …
                    </span>,
                  ]
                : []),
              <button
                type="button"
                className={
                  'button small ' + (n === page ? 'selected' : 'outline')
                }
                key={n}
                aria-label={`Page ${n}`}
                aria-current={n === page ? 'page' : undefined}
                disabled={busy}
                onClick={() => {
                  if (n !== page) navigate(() => onPageChange(n));
                }}
              >
                {n}
              </button>,
            ])}
        </div>
      )}
      <span className="pagination-summary" role="status">
        {summary && <>{summary} · </>}Page {page}
        {pageCount !== undefined && <> of {pageCount}</>}
      </span>
      <button
        type="button"
        className="button outline small"
        disabled={busy || !hasNext}
        onClick={() => navigate(onNext)}
      >
        Next
      </button>
    </nav>
  );
}
