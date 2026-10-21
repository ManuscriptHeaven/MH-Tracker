import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function PasswordRecoveryPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!supabase) { setMessage('Password recovery is unavailable in demo mode.'); return; }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' && session) { setReady(true); setMessage(''); }
    });
    // Supabase exchanges recovery tokens/codes from the redirect URL.
    // A verified authenticated session also permits changing one's own password.
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setMessage('This link is invalid or expired. Request another reset email.');
      else if (data.session) setReady(true);
      else setMessage('Verifying your reset link. If this message remains, request a new link.');
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    if (password.length < 12) { setMessage('Use a password of at least 12 characters.'); return; }
    if (password !== confirmation) { setMessage('Passwords do not match.'); return; }
    if (!supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setComplete(true);
      setPassword('');
      setConfirmation('');
      await supabase.auth.signOut();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update password.');
    } finally { setSaving(false); }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-linen p-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-white p-7 shadow-lg">
        <h1 className="font-display text-3xl font-semibold">Reset your password</h1>
        <p className="mt-2 text-sm text-muted">Employee and client accounts use the same secure reset process.</p>
        {complete ? <p className="mt-5 text-sm text-emerald-700">Password updated successfully. Please sign in again.</p> :
          ready ? (
            <form onSubmit={save} className="mt-6 space-y-4">
              <label className="block text-sm font-medium">New password
                <input className="mt-1 w-full rounded-lg border border-border p-3" type="password" minLength={12} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
              </label>
              <label className="block text-sm font-medium">Confirm password
                <input className="mt-1 w-full rounded-lg border border-border p-3" type="password" minLength={12} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required />
              </label>
              <button disabled={saving} className="w-full rounded-lg bg-ink px-4 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Update password'}</button>
            </form>
          ) : null}
        {message && <p role="alert" className="mt-4 text-sm text-danger">{message}</p>}
        <a href="/" className="mt-5 inline-block text-sm underline">Back to sign in</a>
      </section>
    </main>
  );
}
