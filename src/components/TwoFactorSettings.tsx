import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Button, Card } from './ui';
import {
  listTotpFactors,
  removeTotpFactor,
  startTotpEnrollment,
  verifyTotpCode,
  type TotpFactor,
} from '../lib/mfa';

type Enrollment = { factorId: string; qrCode: string; secret: string };

export function TwoFactorSettings({ highlight }: { highlight?: boolean }) {
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFactors(await listTotpFactors());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load two-factor status.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verified = (factors || []).find((factor) => factor.status === 'verified');

  async function begin() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setEnrollment(await startTotpEnrollment());
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotpCode(enrollment.factorId, code);
      setEnrollment(null);
      setNotice('Two-step verification is on. You will be asked for a code each time you sign in.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (enrollment) {
      try {
        await removeTotpFactor(enrollment.factorId);
      } catch {
        // An unverified factor is cleared on the next setup attempt anyway.
      }
    }
    setEnrollment(null);
    setCode('');
    setError(null);
  }

  async function turnOff() {
    if (!verified) return;
    if (!window.confirm('Turn off two-step verification for your account?')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await removeTotpFactor(verified.id);
      setNotice('Two-step verification is off.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn it off. Sign out, sign in with your code, then try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={highlight ? 'border-gold/40' : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
            {verified ? <ShieldCheck className="h-6 w-6 text-green-600" /> : <ShieldOff className="h-6 w-6 text-muted" />}
            Two-step verification
          </h2>
          <p className="mt-1 text-sm text-muted">
            After your password, sign-in asks for a 6-digit code from an authenticator app (Google Authenticator,
            Microsoft Authenticator, Authy). With it on, finance and payroll data stays locked until the code is entered.
          </p>
          {highlight && !verified && (
            <p className="mt-2 text-sm font-semibold text-ink">Recommended for admin and project manager accounts.</p>
          )}
        </div>
        {factors && !enrollment && (
          verified ? (
            <Button type="button" variant="secondary" onClick={turnOff} disabled={busy}>
              Turn off
            </Button>
          ) : (
            <Button type="button" onClick={begin} disabled={busy}>
              {busy ? 'Starting…' : 'Turn on'}
            </Button>
          )
        )}
      </div>

      {verified && !enrollment && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          On since {new Date(verified.createdAt).toLocaleDateString()}.
        </p>
      )}

      {enrollment && (
        <form onSubmit={confirm} className="mt-5 grid gap-5 sm:grid-cols-[auto,1fr] sm:items-start">
          <img
            src={enrollment.qrCode}
            alt="QR code to add MH Tracker to your authenticator app"
            className="h-44 w-44 rounded-lg border border-border bg-white p-2"
          />
          <div className="grid gap-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>Open your authenticator app and add a new account.</li>
              <li>Scan this QR code, or type the key below.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <code className="break-all rounded-md bg-ivory px-3 py-2 font-mono text-xs text-ink">{enrollment.secret}</code>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-label="Authenticator code"
              className="min-h-11 max-w-[12rem] rounded-md border border-border bg-white px-3 text-center font-mono text-lg tracking-[0.3em] focus:border-gold"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Confirm'}
              </Button>
              <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      )}

      {notice && <p className="mt-4 text-sm text-green-700">{notice}</p>}
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
