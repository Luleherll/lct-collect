import { Component, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main tabIndex={-1} id="main-content" className="login-shell">
        <h1>Let’s reopen your notebook</h1>
        <p>
          The screen could not continue. A save may still have completed. After
          reopening, check recent entries before entering the same money again.
        </p>
        <button className="button" onClick={() => window.location.reload()}>
          Reopen LCT Collect
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
