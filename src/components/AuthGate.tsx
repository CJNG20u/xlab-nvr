import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, RefreshCw } from 'lucide-react';
import {
  AUTH_REQUIRED_EVENT,
  fetchAuthStatus,
  loginRequest,
  logoutRequest,
  setupAccountRequest,
  type AuthStatus,
} from '../lib/api';
import { XlabLogo } from './XlabLogo';

interface AuthContextValue {
  authEnabled: boolean;
  username: string | null;
  signOut: () => Promise<void>;
  /** Called after the server has already ended every session (e.g. "sign out everywhere"). */
  handleSignedOutRemotely: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authEnabled: false,
  username: null,
  signOut: async () => {},
  handleSignedOutRemotely: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

type GateState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; status: AuthStatus };

export function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateState>({ phase: 'loading' });

  const loadStatus = useCallback(async () => {
    setGate({ phase: 'loading' });
    try {
      const status = await fetchAuthStatus();
      setGate({ phase: 'ready', status });
    } catch (err) {
      setGate({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Cannot reach the NVR server.',
      });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Any protected request that comes back 401 (expired / revoked session) returns to the login screen
  useEffect(() => {
    const onAuthRequired = () => {
      setGate((prev) =>
        prev.phase === 'ready' && prev.status.authEnabled
          ? { phase: 'ready', status: { ...prev.status, authenticated: false, username: null } }
          : prev
      );
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const markSignedOut = useCallback(() => {
    setGate((prev) =>
      prev.phase === 'ready'
        ? { phase: 'ready', status: { ...prev.status, authenticated: false, username: null } }
        : prev
    );
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // The cookie may already be invalid; go back to the login screen regardless
    }
    markSignedOut();
  }, [markSignedOut]);

  const ctx = useMemo<AuthContextValue>(
    () => ({
      authEnabled: gate.phase === 'ready' ? gate.status.authEnabled : false,
      username: gate.phase === 'ready' ? gate.status.username : null,
      signOut,
      handleSignedOutRemotely: markSignedOut,
    }),
    [gate, signOut, markSignedOut]
  );

  if (gate.phase === 'loading') {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 text-sm text-zinc-400 py-6">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Connecting…</span>
        </div>
      </AuthShell>
    );
  }

  if (gate.phase === 'error') {
    return (
      <AuthShell>
        <div className="space-y-4 text-center">
          <p className="text-sm text-zinc-300">Can’t reach the NVR server.</p>
          <p className="text-xs text-zinc-500">{gate.message}</p>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 text-zinc-100 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </AuthShell>
    );
  }

  const { status } = gate;

  if (status.authEnabled && status.setupRequired) {
    return (
      <AuthShell>
        <CredentialsForm
          mode="setup"
          minPasswordLength={status.minPasswordLength}
          onSuccess={(next) => setGate({ phase: 'ready', status: next })}
        />
      </AuthShell>
    );
  }

  if (status.authEnabled && !status.authenticated) {
    return (
      <AuthShell>
        <CredentialsForm
          mode="login"
          minPasswordLength={status.minPasswordLength}
          onSuccess={(next) => setGate({ phase: 'ready', status: next })}
        />
      </AuthShell>
    );
  }

  return <AuthContext.Provider value={ctx}>{children}</AuthContext.Provider>;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full h-full bg-black flex items-center justify-center px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <XlabLogo className="w-14 h-14" />
          <h1 className="mt-3 text-lg font-semibold text-zinc-100 tracking-tight">xlab-nvr</h1>
        </div>
        <div className="rounded-xl bg-[#121214] border border-zinc-800 p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

function CredentialsForm({
  mode,
  minPasswordLength,
  onSuccess,
}: {
  mode: 'login' | 'setup';
  minPasswordLength: number;
  onSuccess: (status: AuthStatus) => void;
}) {
  const isSetup = mode === 'setup';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (isSetup) {
      if (password.length < minPasswordLength) {
        setError(`Password must be at least ${minPasswordLength} characters.`);
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      const next = isSetup
        ? await setupAccountRequest(username.trim(), password)
        : await loginRequest(username.trim(), password);
      onSuccess(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-lg bg-black border border-zinc-800 focus:border-[#3b5998] focus:outline-none px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600';

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="text-center">
        <h2 className="text-sm font-semibold text-zinc-100">
          {isSetup ? 'Create your admin account' : 'Sign in'}
        </h2>
        <p className="text-xs text-zinc-500 mt-1">
          {isSetup
            ? 'Choose a username and password to protect your cameras and recordings.'
            : 'Enter your credentials to open your cameras.'}
        </p>
      </div>

      <div>
        <label htmlFor="nvr-username" className="block text-xs text-zinc-400 mb-1">
          Username
        </label>
        <input
          id="nvr-username"
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="nvr-password" className="block text-xs text-zinc-400 mb-1">
          Password
        </label>
        <div className="relative">
          <input
            id="nvr-password"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 px-3 text-zinc-500 hover:text-zinc-200 cursor-pointer"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {isSetup && (
          <p className="text-[11px] text-zinc-500 mt-1">At least {minPasswordLength} characters.</p>
        )}
      </div>

      {isSetup && (
        <div>
          <label htmlFor="nvr-confirm" className="block text-xs text-zinc-400 mb-1">
            Confirm password
          </label>
          <input
            id="nvr-confirm"
            type={showPassword ? 'text' : 'password'}
            name="confirm-password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs px-3 py-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !username.trim() || !password}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[#1e293b] hover:bg-[#3b5998] disabled:opacity-50 disabled:cursor-not-allowed border border-[#3b5998]/50 text-zinc-100 transition-colors cursor-pointer"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
        {isSetup ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}
