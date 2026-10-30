import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, FlaskConical, Link2, RefreshCw, ShieldAlert, Unplug } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type PageConnection = {
  id: string; owner_id: string; brand_id: string; page_id: string;
  page_name: string; status: 'connected' | 'expired' | 'disconnected';
  publish_enabled: boolean; updated_at: string;
};
type DeliveryJob = {
  id: string; target_id: string; revision_id: string; status: string;
  scheduled_at: string; provider_post_id: string | null;
  error_code: string | null; created_at: string;
};
type TargetSummary = { id: string; brandId: string; caption: string };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message
    : e && typeof e === 'object' && 'message' in e
      ? String((e as { message: unknown }).message)
      : 'Request failed.';
}
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const details = await context.json() as { error?: string };
        if (details?.error) message = details.error;
      } catch { /* Keep generic provider error. */ }
    }
    throw new Error(message);
  }
  return data as T;
}

export function FacebookPublishingPanel({
  brandId, adminId, targets, onAfterRun,
}: {
  brandId: string; adminId: string; targets: TargetSummary[];
  onAfterRun?: () => void;
}) {
  const [connections, setConnections] = useState<PageConnection[]>([]);
  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [pageId, setPageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const targetIds = useMemo(
    () => targets.filter(t => t.brandId === brandId).map(t => t.id),
    [targets,brandId],
  );
  const targetKey = targetIds.join(',');

  async function reload() {
    if (!supabase || !brandId) { setConnections([]); setJobs([]); return; }
    setLoading(true);
    try {
      const { data: links, error: linkError } = await supabase.from('social_facebook_connections')
        .select('id,owner_id,brand_id,page_id,page_name,status,publish_enabled,updated_at')
        .eq('brand_id',brandId).eq('owner_id',adminId)
        .order('updated_at',{ascending:false});
      if (linkError) throw linkError;
      let items: DeliveryJob[] = [];
      if (targetIds.length) {
        const { data, error: jobError } = await supabase.from('social_delivery_jobs')
          .select('id,target_id,revision_id,status,scheduled_at,provider_post_id,error_code,created_at')
          .in('target_id',targetIds).order('created_at',{ascending:false}).limit(40);
        if (jobError) throw jobError;
        items = (data||[]) as DeliveryJob[];
      }
      setConnections((links||[]) as PageConnection[]);
      setJobs(items);
      setError('');
    } catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, [brandId,adminId,targetKey]);
  const oauthStatus = typeof window === 'undefined' ? null
    : new URLSearchParams(window.location.search).get('social_fb');

  async function startConnection() {
    if (!brandId || busy) return;
    if (pageId.trim() && !/^[0-9]{3,30}$/.test(pageId.trim())) {
      setError('Facebook Page ID must contain 3–30 digits.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await invoke<{ authorizationUrl: string }>('social-facebook-connect',{
        action:'start',brandId,pageId:pageId.trim()||null,
      });
      const parsed = new URL(data.authorizationUrl);
      if (parsed.protocol!=='https:' || parsed.hostname!=='www.facebook.com') {
        throw new Error('OAuth destination is not Facebook. Connection stopped.');
      }
      window.location.assign(parsed.toString());
    } catch (cause) {
      setError(errorText(cause)); setBusy(false);
    }
  }

  async function disconnect(connection: PageConnection) {
    if (busy || !window.confirm('Disconnect this Facebook Page? This removes its stored token and blocks future posting from MH Tracker.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await invoke('social-facebook-connect',{action:'disconnect',connectionId:connection.id});
      setNotice('Facebook Page disconnected locally and stored Page credentials revoked.');
      await reload();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function testDueJobs() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await invoke<{
        claimed:number;simulated:number;blocked:number;cancelled:number;unknown:number;mode:string;
      }>('social-delivery-worker',{mode:'simulate'});
      setNotice(result.claimed===0
        ? 'No due, currently approved Facebook plans for your admin account. Plan a time first, then run this test when it is due.'
        : 'Fake test finished: '+result.simulated+' simulated, '+result.blocked+' blocked, '
          +result.cancelled+' cancelled, '+result.unknown+' uncertain. Nothing was sent to Facebook.');
      await reload(); onAfterRun?.();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="Facebook Page publishing controls"
      className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
            <Link2 className="h-5 w-5 text-gold" /> Facebook Page Connection
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Authorize a Page through Meta, then dry-run your approved scheduled posts.
            All real publishing remains switched off until separately certified.
          </p>
        </div>
        <button type="button" onClick={() => void reload()} disabled={loading || busy}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink disabled:opacity-40">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Connection does not mean publication.</strong> Meta App ID/Secret and approved
        OAuth redirect must be configured by the administrator. Posts will only be
        simulated at this stage. Never paste Page access tokens into the browser.
      </div>
      {oauthStatus && <div className="rounded-lg border border-border bg-linen p-3 text-xs text-ink">
        Meta authorization result: <strong>{oauthStatus.replace(/_/g,' ')}</strong>.
        Refresh your connections after returning from Facebook.
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border p-4">
          <label className="block text-sm font-semibold text-ink">
            Facebook Page ID (optional when you manage one Page)
            <input value={pageId} onChange={e => setPageId(e.target.value)}
              placeholder="Numeric Page ID, not a profile URL" inputMode="numeric"
              maxLength={30} className="mt-2 w-full rounded-lg border border-border p-3 text-sm" />
          </label>
          <button type="button" onClick={() => void startConnection()}
            disabled={busy || !brandId}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white disabled:opacity-40">
            <ExternalLink className="h-4 w-4" /> Connect through Facebook
          </button>
          <p className="text-xs text-muted">
            Facebook requests permission to list managed Pages and manage Page posts.
            If you have multiple Pages, enter the exact numeric Page ID first.
          </p>
        </div>
        <div className="space-y-3 rounded-xl border border-border p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <FlaskConical className="h-4 w-4 text-gold" /> Scheduled Publishing Test
          </h3>
          <p className="text-xs leading-relaxed text-muted">
            Runs only due, approved Facebook plans through a fake provider. It never
            publishes anything, even if a Page has been connected.
          </p>
          <button type="button" onClick={() => void testDueJobs()} disabled={busy || !brandId}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-semibold text-ink disabled:opacity-40">
            <FlaskConical className="h-4 w-4" /> Run due dry-run
          </button>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-bold text-ink">Connected Page metadata</h3>
        {connections.length===0 && <p className="mt-2 text-sm text-muted">
          No Facebook Pages connected for this brand. The connection is optional for fake publishing tests.
        </p>}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {connections.map(connection => (
            <div key={connection.id} className="rounded-xl border border-border bg-linen p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="min-w-0 truncate text-sm text-ink">{connection.page_name}</strong>
                <span className="text-xs font-semibold capitalize text-muted">{connection.status}</span>
              </div>
              <p className="mt-1 text-xs text-muted">Page ID: {connection.page_id}</p>
              <p className="mt-1 text-xs font-semibold text-amber-900">
                Real publishing: {connection.publish_enabled?'Enabled by server release gate':'Disabled'}
              </p>
              {connection.status==='connected' &&
                <button type="button" onClick={() => void disconnect(connection)} disabled={busy}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-red-700 disabled:opacity-40">
                  <Unplug className="h-3.5 w-3.5" /> Disconnect Page
                </button>}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-bold text-ink">Delivery results</h3>
        {jobs.length===0 && <p className="mt-2 text-sm text-muted">
          No delivery attempts yet. Approve a post and plan a Facebook date to create a queued test job.
        </p>}
        <div className="mt-2 space-y-2">
          {jobs.map(job => {
            const target = targets.find(item=>item.id===job.target_id);
            const uncertain = ['unknown','blocked'].includes(job.status);
            return <article key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm text-ink">{target?.caption||'Facebook post'}</div>
                <p className="mt-1 text-xs text-muted">{new Date(job.scheduled_at).toLocaleString()}
                  {job.error_code ? ' · '+job.error_code : ''}</p>
              </div>
              <span className={uncertain?'text-xs font-bold text-red-700':'text-xs font-bold text-ink'}>
                {uncertain ? <ShieldAlert className="mr-1 inline h-4 w-4"/> :
                  <CheckCircle2 className="mr-1 inline h-4 w-4"/>}
                {job.status==='simulated'?'Test completed — not published':job.status}
              </span>
            </article>;
          })}
        </div>
      </div>
    </section>
  );
}
