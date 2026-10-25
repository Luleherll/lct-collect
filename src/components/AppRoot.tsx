import App from './App';
import ErrorBoundary from './ErrorBoundary';
export default function AppRoot(props: { route: string }) {
  return (
    <ErrorBoundary>
      <App {...props} />
    </ErrorBoundary>
  );
}
