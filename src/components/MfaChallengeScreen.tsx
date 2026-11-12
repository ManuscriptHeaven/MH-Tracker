import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from './ui';
import { listTotpFactors, verifyTotpCode } from '../lib/mfa';

export function MfaChallengeScreen({
  email,
  onVerified,
  onSignOut,
}: {
  email?: string;
  onVerified: () => void;
  onSignOut: () => void;
}) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listTotpFactors()
      .then((factors) => {
        if (!active) return;
        const verified = factors.find((factor) => factor.status === 'verified');
        if (verified) setFactorId(verified.id);
        else setError('No authenticator is linked to this account. Sign out and sign in again.');
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : 'Could not load your authenticator.'));
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!factorId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotpCode(factorId, code);
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-ivory px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-3xl border border-border/70 bg-white px-7 py-9 shadow-soft"
      >
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gold/15 text-gold">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-center font-display text-2xl font-semibold text-ink">Two-step verification</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Enter the 6-digit code from your authenticator app{email ? ` for ${email}` : ''}.
        </p>

        <label className="mt-6 grid gap-1.5 text-sm font-medium text-ink">
          <span>Authenticator code</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            className="min-h-12 rounded-md border border-border bg-white px-3 text-center font-mono text-xl tracking-[0.4em] text-ink focus:border-gold"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" className="mt-5 w-full" disabled={!factorId || busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Verify and continue'}
        </Button>
        <Button type="button" variant="ghost" className="mt-2 w-full" onClick={onSignOut}>
          Sign out
        </Button>
      </form>
    </main>
  );
}
