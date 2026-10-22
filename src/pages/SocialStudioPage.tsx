import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Edit3, Megaphone, Plus, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

type Brand = { id: string; name: string; brief: string; owner_id: string };
type Post = { id: string; brand_id: string; owner_id: string; created_at: string };
type Revision = { id: string; post_id: string; revision_number: number; caption: string; created_at: string };
type Target = {
  id: string; post_id: string; channel: string; status: string;
  approved_revision_id: string | null; approved_by: string | null; approved_at: string | null;
  scheduled_at: string | null;
};
type FeedItem = { post: Post; target: Target; revision: Revision | undefined; brand: Brand | undefined };

const CHANNELS = [
  { id: 'facebook', label: 'Facebook Page' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin', label: 'LinkedIn' },
];

function toDate(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message :
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Operation failed. Check your network connection and try again.';
}

export function SocialStudioPage({ currentProfile }: { currentProfile: Profile }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [brandName, setBrandName] = useState('Manuscript Heaven');
  const [caption, setCaption] = useState('');
  const [channel, setChannel] = useState('facebook');
  const [editing, setEditing] = useState<string | null>(null);
  const [editedCaption, setEditedCaption] = useState('');
  const [scheduledDates, setScheduledDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function reload() {
    if (!supabase) {
      setError('Supabase is not configured for this deployment.');
      setLoading(false);
      return;
    }
    try {
      const [b, p, r, t] = await Promise.all([
        supabase.from('social_brands').select('id,name,brief,owner_id').order('created_at', { ascending: true }),
        supabase.from('social_posts').select('id,brand_id,owner_id,created_at').order('created_at', { ascending: false }),
        supabase.from('social_post_revisions').select('id,post_id,revision_number,caption,created_at'),
        supabase.from('social_post_targets').select('id,post_id,channel,status,approved_revision_id,approved_by,approved_at,scheduled_at'),
      ]);
      for (const result of [b, p, r, t]) if (result.error) throw result.error;
      setBrands((b.data || []) as Brand[]);
      setPosts((p.data || []) as Post[]);
      setRevisions((r.data || []) as Revision[]);
      setTargets((t.data || []) as Target[]);
      setSelectedBrand(previous => (b.data || []).some(item => item.id === previous)
        ? previous : b.data?.[0]?.id || '');
      setError('');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [currentProfile.id]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!supabase) throw new Error('Database connection unavailable.');
      await action();
      await reload();
      setMessage(success);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const feed = useMemo<FeedItem[]>(() => {
    return posts.flatMap(post => {
      const target = targets.find(item => item.post_id === post.id);
      if (!target) return [];
      const revision = revisions.filter(item => item.post_id === post.id)
        .sort((a, b) => b.revision_number - a.revision_number)[0];
      return [{ post, target, revision, brand: brands.find(item => item.id === post.brand_id) }];
    });
  }, [posts, revisions, targets, brands]);

  const counts = {
    drafts: feed.filter(item => item.target.status === 'draft').length,
    review: feed.filter(item => item.target.status === 'in_review').length,
    approved: feed.filter(item => item.target.status === 'approved').length,
    scheduled: feed.filter(item => item.target.status === 'scheduled').length,
  };

  async function createBrand() {
    if (!brandName.trim() || !supabase) return;
    await run(async () => {
      const { error: err } = await supabase!.from('social_brands')
        .insert({ name: brandName.trim(), owner_id: currentProfile.id });
      if (err) throw err;
    }, 'Brand workspace created.');
  }

  async function createDraft() {
    if (!caption.trim() || !selectedBrand || !supabase) return;
    await run(async () => {
      const { error: err } = await supabase!.rpc('social_create_draft', {
        p_brand_id: selectedBrand, p_caption: caption.trim(), p_channel: channel,
      });
      if (err) throw err;
      setCaption('');
    }, 'Post draft saved securely.');
  }

  async function saveRevision(postId: string) {
    if (!editedCaption.trim() || !supabase) return;
    await run(async () => {
      const { error: err } = await supabase!.rpc('social_append_revision', {
        p_post_id: postId, p_caption: editedCaption.trim(),
      });
      if (err) throw err;
      setEditing(null);
      setEditedCaption('');
    }, 'New revision saved; previous approval and schedule cleared.');
  }

  async function transition(target: Target, updates: Record<string, unknown>, success: string) {
    if (!supabase) return;
    await run(async () => {
      const { error: err } = await supabase!.from('social_post_targets')
        .update(updates).eq('id', target.id).eq('owner_id', currentProfile.id).select('id').single();
      if (err) throw err;
    }, success);
  }

  if (currentProfile.role !== 'admin') {
    return <div className="rounded-xl border border-border bg-white p-6 text-sm">Social Studio is currently available to admins only.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-gold">
              <Megaphone className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-widest">Manuscript Heaven</span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold text-ink sm:text-3xl">Social Media Studio</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">Create captions, review revisions, approve exact content and plan posts.</p>
          </div>
          <button onClick={() => void reload()} disabled={busy || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-linen disabled:opacity-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Live pilot · planning only.</strong> Posts are saved in Supabase, but no social accounts are connected.
          Scheduled items are reminders/plans, <strong>not automatically published</strong>. AI generation and media upload are not enabled yet.
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Drafts', value: counts.drafts },
            { label: 'In review', value: counts.review },
            { label: 'Approved', value: counts.approved },
            { label: 'Planned', value: counts.scheduled },
          ].map(item => (
            <div key={item.label} className="rounded-xl border border-border/80 bg-linen p-4">
              <div className="text-2xl font-bold text-ink">{item.value}</div>
              <div className="mt-1 text-xs font-medium text-muted">{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><ShieldCheck className="h-5 w-5 text-gold" /> Your Brand</h2>
          {brands.length > 0 ? (
            <label className="block text-sm font-medium text-ink">
              Brand workspace
              <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
                className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm">
                {brands.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}
              </select>
            </label>
          ) : (
            <p className="text-sm text-muted">Start by creating a private brand workspace.</p>
          )}
          <label className="block text-sm font-medium text-ink">
            New brand name
            <input value={brandName} onChange={e => setBrandName(e.target.value)} maxLength={120}
              className="mt-2 w-full rounded-lg border border-border p-3 text-sm" />
          </label>
          <button onClick={() => void createBrand()} disabled={busy || !brandName.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-bold hover:bg-linen disabled:opacity-50">
            <Plus className="h-4 w-4" /> Add Brand Workspace
          </button>
        </section>

        <section className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm lg:col-span-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Edit3 className="h-5 w-5 text-gold" /> Create a Post</h2>
          <label className="block text-sm font-medium text-ink">
            Destination (planning only)
            <select value={channel} onChange={e => setChannel(e.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm">
              {CHANNELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-ink">
            Caption
            <textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={8000}
              placeholder="Share a publishing tip, client-safe case study, or book formatting insight..."
              rows={5} className="mt-2 w-full resize-y rounded-lg border border-border p-3 text-sm" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted">{caption.length} / 8,000 characters</span>
            <button onClick={() => void createDraft()} disabled={busy || !caption.trim() || !selectedBrand}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
              <Plus className="h-4 w-4" /> Save Draft
            </button>
          </div>
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-ink">Content Pipeline</h2>
          <span className="text-sm text-muted">{feed.length} posts</span>
        </div>
        {loading ? <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted">Loading your Studio...</div>
          : feed.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted">
              No posts yet. Save your first draft above to start reviewing content.
            </div>
          ) : feed.map(item => {
            const t = item.target;
            const r = item.revision;
            const isEditing = editing === item.post.id;
            const isApproved = t.status === 'approved';
            const isScheduled = t.status === 'scheduled';
            return (
              <article key={item.post.id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-muted">
                    {item.brand?.name || 'Brand'} · {CHANNELS.find(c => c.id === t.channel)?.label || t.channel}
                    {' · '}Revision {r?.revision_number ?? 0}
                  </div>
                  <span className="rounded-full border border-border bg-linen px-3 py-1 text-xs font-bold capitalize text-ink">
                    {isScheduled ? 'Planned (not published)' : t.status.replace('_', ' ')}
                  </span>
                </div>
                {isEditing ? (
                  <div className="mt-4 space-y-3">
                    <textarea rows={5} maxLength={8000} value={editedCaption}
                      onChange={e => setEditedCaption(e.target.value)}
                      className="w-full rounded-lg border border-border p-3 text-sm" />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void saveRevision(item.post.id)} disabled={busy || !editedCaption.trim()}
                        className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save new revision</button>
                      <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel edit</button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{r?.caption || '(No caption)'}</p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {!isEditing && t.status !== 'cancelled' &&
                      <button disabled={busy} onClick={() => { setEditing(item.post.id); setEditedCaption(r?.caption || ''); }}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">
                        <Edit3 className="h-3.5 w-3.5" /> Edit
                      </button>}
                    {t.status === 'draft' && !!r &&
                      <button disabled={busy} onClick={() => void transition(t, { status: 'in_review' }, 'Draft sent for review.')}
                        className="rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Submit for review</button>}
                    {t.status === 'in_review' && !!r &&
                      <button disabled={busy} onClick={() => void transition(t, {
                        status: 'approved', approved_revision_id: r.id, approved_by: currentProfile.id,
                        approved_at: new Date().toISOString(),
                      }, 'This exact content revision is approved.')}
                        className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve revision
                      </button>}
                    {(t.status === 'in_review' || isApproved || isScheduled) &&
                      <button disabled={busy} onClick={() => void transition(t, {
                        status: 'draft', approved_revision_id: null, approved_by: null,
                        approved_at: null, scheduled_at: null,
                      }, 'Returned to draft. Previous approval and schedule removed.')}
                        className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">Return to draft</button>}
                  </div>
                  <div className="text-xs text-muted">
                    {isScheduled ? 'Planned: ' + toDate(t.scheduled_at) :
                      isApproved ? 'Approved: ' + toDate(t.approved_at) :
                        'Created: ' + toDate(item.post.created_at)}
                  </div>
                </div>
                {isApproved && (
                  <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-linen p-3">
                    <label className="flex-1 text-xs font-medium text-ink">
                      Planned date and time (your timezone)
                      <input type="datetime-local" value={scheduledDates[t.id] || ''}
                        onChange={e => setScheduledDates(prev => ({ ...prev, [t.id]: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-sm" />
                    </label>
                    <button disabled={busy || !scheduledDates[t.id] || new Date(scheduledDates[t.id]).getTime() <= Date.now()}
                      onClick={() => void transition(t, {
                        status: 'scheduled', scheduled_at: new Date(scheduledDates[t.id]).toISOString(),
                      }, 'Posting time planned. No automatic publishing will occur.')}
                      className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-3 text-xs font-bold text-white disabled:opacity-40">
                      <CalendarClock className="h-4 w-4" /> Plan post
                    </button>
                  </div>
                )}
              </article>
            );
          })}
      </section>
      <footer className="flex items-center gap-2 text-xs text-muted">
        <Send className="h-3.5 w-3.5" /> External posting, OAuth, AI image creation and analytics are excluded from this test release.
      </footer>
    </div>
  );
}
