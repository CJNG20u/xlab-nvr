import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { changePasswordRequest, logoutAllRequest } from '../lib/api';
import { useAuth } from './AuthGate';

const MIN_PASSWORD_LENGTH = 10;

export function SecuritySection() {
  const { authEnabled, username, signOut, handleSignedOutRemotely } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (!authEnabled) {
    return (
      <section className="rounded-xl bg-[#121214] border border-zinc-800 p-5">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-amber-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Security</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Login is turned off (<span className="font-mono">NVR_AUTH_DISABLED=true</span>).
              Anyone who can reach this server can view your cameras. Remove that setting to
              require a sign-in.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setMessage(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage({ kind: 'error', text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      const res = await changePasswordRequest(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({
        kind: 'ok',
        text:
          res.otherSessionsSignedOut > 0
            ? `Password updated. ${res.otherSessionsSignedOut} other signed-in ${
                res.otherSessionsSignedOut === 1 ? 'device was' : 'devices were'
              } signed out.`
            : 'Password updated.',
      });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not change password.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    if (busy) return;
    if (!window.confirm('Sign out of every device, including this one?')) return;
    setBusy(true);
    try {
      await logoutAllRequest();
      handleSignedOutRemotely();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not sign out.' });
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-lg bg-black border border-zinc-800 focus:border-[#3b5998] focus:outline-none px-3 py-2 text-sm text-zinc-100';

  return (
    <section className="rounded-xl bg-[#121214] border border-zinc-800 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100">Security</h2>
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              Signed in as <span className="font-medium text-zinc-200">{username}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 text-zinc-100 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
          <button
            type="button"
            onClick={() => void handleSignOutEverywhere()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 border border-zinc-800 text-zinc-300 transition-colors cursor-pointer"
          >
            Sign out everywhere
          </button>
        </div>
      </div>

      <form onSubmit={handleChangePassword} className="space-y-3 border-t border-zinc-800 pt-4" noValidate>
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" />
          Change password
        </h3>
        {/* Hidden username helps password managers attach the new password to the right account */}
        <input type="text" name="username" autoComplete="username" value={username ?? ''} readOnly hidden />
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="password"
            placeholder="Current password"
            aria-label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            placeholder="New password"
            aria-label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            aria-label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1e293b] hover:bg-[#3b5998] disabled:opacity-50 disabled:cursor-not-allowed border border-[#3b5998]/50 text-zinc-100 transition-colors cursor-pointer"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Update password
          </button>
          {message && (
            <p
              role="status"
              className={`flex items-center gap-1.5 text-xs ${
                message.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {message.kind === 'ok' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              {message.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
