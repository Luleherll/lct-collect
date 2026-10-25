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
}) {
  return (
    <nav className="pagination" aria-label={label}>
      <button
        className="button outline small"
        disabled={busy || !hasPrevious}
        onClick={onPrevious}
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
        onClick={onNext}
      >
        Next
      </button>
    </nav>
  );
}
