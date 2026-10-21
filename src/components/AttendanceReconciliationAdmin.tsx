import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, History, ShieldCheck } from 'lucide-react';
import { Button, Card, TextareaField } from './ui';
import { supabase } from '../lib/supabase';
import type { AttendanceSession, Profile } from '../lib/types';

type ReconciliationSummary = {
  session_id: string;
  recorded_seconds: number | string;
  dated_seconds: number | string;
  unattributed_seconds: number | string;
  overcredited_discrepancy_seconds: number | string;
};

type AuditEvent = {
  id: string;
  action_type: string;
  created_at: string;
  performed_by: string;
  reason: string;
  evidence_note: string;
  previous_record: { verified_seconds?: number; clock_in?: string; clock_out?: string };
  updated_record: { verified_seconds?: number; clock_in?: string; clock_out?: string };
};

type Props = {
  currentProfile: Profile;
  profiles: Profile[];
  sessions: AttendanceSession[];
  onReconciled: () => Promise<void>;
};

function formatSeconds(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((value % 3600) / 60).toString().padStart(2, '0');
  const secs = (value % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
}

function parseSeconds(value: string) {
  const match = /^(\d{1,5}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function AttendanceReconciliationAdmin({
  currentProfile, profiles, sessions, onReconciled,
}: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [proposedTime, setProposedTime] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [auditRefreshVersion, setAuditRefreshVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setAuditRefreshVersion((previous) => previous + 1);
    window.addEventListener('mh:attendance-reconciled', refresh);
    return () => window.removeEventListener('mh:attendance-reconciled', refresh);
  }, []);


  const completedSessions = useMemo(() => sessions
    .filter((session) => session.status === 'completed' && session.clock_out)
    .sort((a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime())
    .slice(0, 150), [sessions]);

  const selected = completedSessions.find((session) => session.id === selectedId) || null;
  const candidateSeconds = parseSeconds(proposedTime);
  const acceptedSeconds = Number(summary?.dated_seconds || 0);
  const originalSeconds = Number(summary?.recorded_seconds || 0);
  const hasChanged = candidateSeconds !== null && candidateSeconds !== originalSeconds;
  const valid = Boolean(
    selected && summary && candidateSeconds !== null && candidateSeconds >= acceptedSeconds
    && hasChanged && reason.trim().length >= 15 && evidence.trim().length >= 10 && confirmed,
  );

  useEffect(() => {
    if (currentProfile.role !== 'admin' || !selectedId || !supabase) {
      setSummary(null);
      setAudit([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const load = async () => {
      if (!supabase) return;
      const [balance, history] = await Promise.all([
        supabase.from('attendance_session_credit_reconciliation')
          .select('session_id,recorded_seconds,dated_seconds,unattributed_seconds,overcredited_discrepancy_seconds')
          .eq('session_id', selectedId).single(),
        supabase.from('attendance_reconciliation_audit')
          .select('id,action_type,created_at,performed_by,reason,evidence_note,previous_record,updated_record')
          .eq('session_id', selectedId).order('created_at', { ascending: false }).limit(25),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (balance.error || history.error || !balance.data) {
        setError('Admin reconciliation is not available until the protected database migration passes release certification.');
        setSummary(null);
        setAudit([]);
        return;
      }
      const row = balance.data as ReconciliationSummary;
      setSummary(row);
      setProposedTime(formatSeconds(Number(row.recorded_seconds || 0)));
      setAudit((history.data || []) as AuditEvent[]);
    };
    void load();
    return () => { cancelled = true; };
  }, [currentProfile.role, selectedId, notice, auditRefreshVersion]);

  if (currentProfile.role !== 'admin') return null;

  const handleSelect = (sessionId: string) => {
    setSelectedId(sessionId);
    setSummary(null);
    setProposedTime('');
    setReason('');
    setEvidence('');
    setConfirmed(false);
    setError('');
    setNotice('');
  };

  const approve = async () => {
    if (!valid || !selected || !summary || candidateSeconds === null || !supabase || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError, data } = await supabase.rpc('attendance_admin_reconcile_session', {
        p_session_id: selected.id,
        p_corrected_seconds: candidateSeconds,
        p_expected_seconds: originalSeconds,
        p_reason: reason.trim(),
        p_evidence_note: evidence.trim(),
      });
      if (rpcError) throw rpcError;
      if (!data) throw new Error('The server did not return the corrected attendance session.');
      setNotice('Correction approved and recorded in the immutable admin audit history.');
      setReason('');
      setEvidence('');
      setConfirmed(false);
      await onReconciled();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reconciliation failed. No correction was confirmed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-gold" />
        <div>
          <h3 className="font-display text-xl font-semibold text-ink">Admin · Historical attendance reconciliation</h3>
          <p className="mt-1 text-xs text-muted">
            Adjust only completed session totals with supporting evidence. Daily verified credits remain immutable.
            The original record, new record, approving admin, reason and evidence are permanently logged.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <label htmlFor="attendance-reconcile-session" className="text-xs font-bold text-ink">
          Completed session to review
        </label>
        <select
          id="attendance-reconcile-session"
          value={selectedId}
          onChange={(event) => handleSelect(event.target.value)}
          className="mt-2 w-full rounded-xl border border-border bg-white p-3 text-sm text-ink"
        >
          <option value="">Select an attendance session</option>
          {completedSessions.map((session) => {
            const employee = profiles.find((member) => member.id === session.user_id);
            return (
              <option key={session.id} value={session.id}>
                {employee?.full_name || 'Team member'} · {new Date(session.clock_in).toLocaleDateString()}
                {' · '}{formatSeconds(Number(session.verified_seconds || 0))}
              </option>
            );
          })}
        </select>
      </div>

      {loading && <p className="mt-3 text-sm text-muted">Loading verified credits and audit history…</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}

      {selected && summary && !loading ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([
              { label: 'Recorded', value: formatSeconds(originalSeconds) },
              { label: 'Accepted dated', value: formatSeconds(acceptedSeconds) },
              { label: 'Historical unattributed', value: formatSeconds(Number(summary.unattributed_seconds || 0)) },
              { label: 'Ledger discrepancy', value: formatSeconds(Number(summary.overcredited_discrepancy_seconds || 0)) },
            ] as const).map((item) => (
              <div key={item.label} className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted">{item.label}</p>
                <p className="mt-1 font-mono text-base font-semibold text-ink">{item.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            A corrected session total cannot be lower than accepted dated credits or higher than its clock-in/out duration after breaks.
            It never creates historical daily records.
          </div>

          <label htmlFor="attendance-corrected-time" className="mt-4 block text-xs font-bold text-ink">
            Proposed corrected total · HH:MM:SS
          </label>
          <input id="attendance-corrected-time" type="text" inputMode="numeric"
            placeholder="08:00:00" value={proposedTime} onChange={(event) => {
              setProposedTime(event.target.value); setConfirmed(false);
            }}
            className="mt-2 w-full rounded-xl border border-border p-3 font-mono text-sm text-ink" />
          <div className="mt-3">
            <TextareaField label="Correction reason · minimum 15 characters" value={reason}
              onChange={(event) => { setReason(event.target.value); setConfirmed(false); }}
              placeholder="Explain exactly why the recorded time must change." />
          </div>
          <div className="mt-3">
            <TextareaField label="Supporting evidence / reference · minimum 10 characters" value={evidence}
              onChange={(event) => { setEvidence(event.target.value); setConfirmed(false); }}
              placeholder="Timesheet, office log, employee confirmation or other review evidence." />
          </div>
          <label className="mt-4 flex items-start gap-2 text-xs text-charcoal">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I reviewed the original record and evidence, and approve this change for the audit history.
          </label>
          <Button type="button" disabled={!valid || busy} onClick={() => void approve()} className="mt-4 min-h-11">
            <ClipboardCheck className="h-4 w-4" /> {busy ? 'Recording approval…' : 'Approve and audit correction'}
          </Button>

          <div className="mt-6 border-t border-border pt-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <History className="h-4 w-4" /> Permanent audit history
            </h4>
            {audit.length === 0 ? (
              <p className="mt-2 text-xs text-muted">No approved corrections for this session.</p>
            ) : (
              <div className="mt-3 max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {audit.map((entry) => (
                  <div key={entry.id} className="space-y-1 p-3 text-xs">
                    <p className="font-semibold text-ink">
                      {entry.action_type === 'verified_seconds_reconciliation' ? 'Recorded hours corrected' : 'Session clock times corrected'}
                      {' · '}{new Date(entry.created_at).toLocaleString()}
                    </p>
                    <p>Approved by: {profiles.find((person) => person.id === entry.performed_by)?.full_name || 'Administrator'}</p>
                    <p>Recorded seconds: {formatSeconds(Number(entry.previous_record.verified_seconds || 0))}
                      {' → '}{formatSeconds(Number(entry.updated_record.verified_seconds || 0))}</p>
                    <p>Reason: {entry.reason}</p>
                    <p>Evidence: {entry.evidence_note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </Card>
  );
}
