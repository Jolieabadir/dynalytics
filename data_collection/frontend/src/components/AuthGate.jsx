/**
 * AuthGate — the sign-up / sign-in screen.
 *
 * Shown whenever there is no Supabase session. Every /api route except
 * /api/health now requires a bearer token, so without this the app 401s on its
 * very first call and sits on a loading screen forever.
 *
 * Deliberately minimal: email and password, one toggle between sign in and
 * sign up, and errors in plain language. Labelers are a handful of known
 * people, not the public.
 */
import { useState } from 'react';
import { signIn, signUp, isAuthConfigured } from '../api/auth';

function AuthGate() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const configured = isAuthConfigured();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError('Enter both an email address and a password.');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setError('Choose a password of at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email.trim(), password);
        if (needsConfirmation) {
          setNotice(
            'Account created. Check your email for a confirmation link, then sign in.'
          );
          setMode('signin');
          setPassword('');
        }
        // With confirmation off, Supabase returns a session and the auth
        // listener in App swaps this screen out on its own.
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <h1>Dynalytix</h1>
        <p className="auth-subtitle">Climbing Movement Data Collection</p>

        {!configured && (
          <div className="error-message">
            Sign-in is not configured in this build — VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY are missing. The app cannot reach the API
            without them.
          </div>
        )}

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => { setMode('signin'); setError(null); }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(null); }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || !configured}
            className="auth-input"
          />

          <label className="auth-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy || !configured}
            className="auth-input"
          />

          {error && <div className="error-message">{error}</div>}
          {notice && <div className="notice-message">{notice}</div>}

          <button
            type="submit"
            className="btn-primary auth-submit"
            disabled={busy || !configured}
          >
            {busy
              ? mode === 'signup' ? 'Creating account…' : 'Signing in…'
              : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="auth-footnote">
          {mode === 'signin'
            ? 'No account yet? Choose Sign up above.'
            : 'Already have an account? Choose Sign in above.'}
        </p>
      </div>
    </div>
  );
}

export default AuthGate;
