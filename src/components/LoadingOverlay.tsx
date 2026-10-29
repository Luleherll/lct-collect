export default function LoadingOverlay() {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div>
        <span className="button-spinner" aria-hidden="true" />
        <span>Loading your notebook…</span>
      </div>
    </div>
  );
}
