import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, prepareLogin } from '../lib/firebase';
import { usernameEmail } from '../lib/domain';
import { message } from '../lib/errors';
import { storage } from '../lib/storage';
import Icon from './Icon';
import Brand from './Brand';
export default function Login({ notice }: { notice: string }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  const [fieldError, setFieldError] = useState<{
    field: 'username' | 'password';
    text: string;
  } | null>(null);
  const [cacheWarning] = useState(() => {
    const warning = storage.get('session', 'lct-cache-warning') ?? '';
    storage.remove('session', 'lct-cache-warning');
    return warning;
  });
  return (
    <div className="login-page">
      <header className="login-brand">
        <Brand />
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
            if (busy) return;
            setError('');
            setFieldError(null);
            const form = e.currentTarget;
            const data = new FormData(form);
            let email: string;
            let invalid: 'username' | 'password' = 'username';
            try {
              email = usernameEmail(data.get('username') as string);
              invalid = 'password';
              if (!data.get('password'))
                throw new Error('Enter your password.');
            } catch (err) {
              setFieldError({ field: invalid, text: message(err) });
              (form.elements.namedItem(invalid) as HTMLInputElement)?.focus();
              return;
            }
            setBusy(true);
            try {
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
          <label htmlFor="login-username">
            Username
            <input
              id="login-username"
              name="username"
              disabled={busy}
              aria-invalid={fieldError?.field === 'username'}
              aria-describedby={
                fieldError?.field === 'username' ? 'username-error' : undefined
              }
              onChange={() => {
                setFieldError(null);
                setError('');
              }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="Your username"
            />
            {fieldError?.field === 'username' && (
              <span className="field-error" id="username-error" role="alert">
                {fieldError.text}
              </span>
            )}
          </label>
          <div className="password-field">
            <label htmlFor="login-password">Password</label>
            <div className="password-input">
              <input
                id="login-password"
                name="password"
                disabled={busy}
                aria-invalid={fieldError?.field === 'password'}
                aria-describedby={
                  fieldError?.field === 'password'
                    ? 'password-error'
                    : undefined
                }
                onChange={() => {
                  setFieldError(null);
                  setError('');
                }}
                aria-label="Password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="Your password"
              />
              <button
                type="button"
                className="icon-button"
                aria-pressed={show}
                aria-controls="login-password"
                aria-label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow((v) => !v)}
              >
                <Icon name="eye" />
              </button>
            </div>
            {fieldError?.field === 'password' && (
              <span className="field-error" id="password-error" role="alert">
                {fieldError.text}
              </span>
            )}
          </div>
          <p className="small-note">
            Records you view are automatically saved on this device for offline
            viewing. Sign out to clear them. Sign-in lasts for this browser
            session.
          </p>
          <button className="button full" disabled={busy} aria-busy={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
            {busy ? (
              <span className="button-spinner" aria-hidden="true" />
            ) : (
              <Icon name="arrow-right" />
            )}
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
