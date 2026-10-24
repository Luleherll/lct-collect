import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, prepareLogin } from '../lib/firebase';
import { usernameEmail } from '../lib/domain';
import { message } from '../lib/errors';
import { storage } from '../lib/storage';
import Icon from './Icon';
export default function Login({ notice }: { notice: string }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  const [cacheWarning] = useState(() => {
    const warning = storage.get('session', 'lct-cache-warning') ?? '';
    storage.remove('session', 'lct-cache-warning');
    return warning;
  });
  return (
    <div className="login-page">
      <header className="login-brand">
        <span>LCT Collect</span>
        <p>Lusaze Community Traders SACCO</p>
      </header>
      <main tabIndex={-1} id="main-content" className="login-shell">
        <h1>Welcome back</h1>
        <p>Sign in with your assigned username.</p>
        {(error || notice || cacheWarning) && (
          <div className="alert error" role="alert">
            {error || notice || cacheWarning}
          </div>
        )}
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setBusy(true);
            const data = new FormData(e.currentTarget);
            try {
              const email = usernameEmail(data.get('username') as string);
              if (!data.get('password'))
                throw new Error('Enter your password.');
              await prepareLogin();
              await signInWithEmailAndPassword(
                auth,
                email,
                data.get('password') as string,
              );
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="Your username"
            />
          </label>
          <label>
            Password
            <div className="password-input">
              <input
                name="password"
                aria-label="Password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="Your password"
              />
              <button
                type="button"
                className="icon-button"
                aria-label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow((v) => !v)}
              >
                <Icon name="eye" />
              </button>
            </div>
          </label>
          <p className="small-note">
            Records you view are automatically saved on this device for offline
            viewing. Sign out to remove saved records. Sign-in lasts for this
            browser session.
          </p>
          <button className="button full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
            <Icon name="arrow-right" />
          </button>
        </form>
        <p className="login-help">
          Need an account or a password reset? Contact the SACCO owner.
        </p>
        {import.meta.env.PUBLIC_APP_ENV !== 'production' && (
          <span className="environment">Staging environment</span>
        )}
      </main>
    </div>
  );
}
