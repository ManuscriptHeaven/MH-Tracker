import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Two-factor authentication (TOTP authenticator app) helpers.
 *
 * Supabase issues an "aal1" session after the password step. Users who have a
 * verified authenticator must enter a 6-digit code to raise the session to
 * "aal2". Finance and payroll tables are protected in the database by a
 * restrictive RLS policy that requires aal2 for those users, so this screen is
 * a convenience: skipping it in the browser does not reveal that data.
 */

export type MfaGateStatus = 'checking' | 'required' | 'ok';

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
  status: 'verified' | 'unverified';
  createdAt: string;
}

function requireClient() {
  if (!supabase) throw new Error('Two-factor authentication needs the live Supabase connection.');
  return supabase;
}

export async function listTotpFactors(): Promise<TotpFactor[]> {
  const client = requireClient();
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all || [])
    .filter((factor) => factor.factor_type === 'totp')
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
      status: factor.status as TotpFactor['status'],
      createdAt: factor.created_at,
    }));
}

export async function verifyTotpCode(factorId: string, code: string) {
  const client = requireClient();
  const cleanCode = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) throw new Error('Enter the 6-digit code from your authenticator app.');
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: cleanCode });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('invalid') || message.includes('expired')) {
      throw new Error('That code did not match. Check the time on your phone and try the newest code.');
    }
    throw error;
  }
}

export async function startTotpEnrollment() {
  const client = requireClient();
  // An abandoned setup leaves an unverified factor behind; clear it first so
  // a fresh QR code can be issued.
  const existing = await listTotpFactors();
  for (const factor of existing.filter((item) => item.status === 'unverified')) {
    await client.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `MH Tracker ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) throw error;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function removeTotpFactor(factorId: string) {
  const client = requireClient();
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export async function getMfaGateStatus(): Promise<MfaGateStatus> {
  if (!supabase) return 'ok';
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return 'ok';
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2' ? 'required' : 'ok';
}

/** Decides whether the signed-in user still has to enter an authenticator code. */
export function useMfaGate(active: boolean, userKey: string | null | undefined) {
  const [status, setStatus] = useState<MfaGateStatus>('checking');

  const recheck = useCallback(async () => {
    if (!active) {
      setStatus('ok');
      return;
    }
    setStatus('checking');
    try {
      setStatus(await getMfaGateStatus());
    } catch {
      setStatus('ok');
    }
  }, [active]);

  useEffect(() => {
    void recheck();
  }, [recheck, userKey]);

  return { status, recheck };
}
