import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FilePenLine, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Platform = 'facebook' | 'instagram' | 'linkedin';
type Status = 'draft' | 'in_review' | 'approved';

interface Brand { id: string; name: string }
interface Post {
  id: string;
  brand_id: string;
  title: string;
  status: Status;
  current_revision_id: string;
  approved_revision_id: string | null;
  approved_at: string | null;
  updated_at: string;
}
interface Revision {
  id: string;
  post_id: string;
  revision_no: number;
  platform: Platform;
  caption: string;
  image_brief: string;
}

const emptyDraft = { title: '', platform: 'facebook' as Platform, caption: '', imageBrief: '' };

export function SocialStudioPage({ liveWorkspace }: { liveWorkspace: boolean }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !liveWorkspace) {
      setError('Sign in to the live workspace to use Social Studio.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: brands, error: brandError } = await supabase
        .from('social_brands').select('id,name').eq('slug', 'manuscript-heaven').single();
      if (brandError) throw brandError;
      const [postResult, revisionResult] = await Promise.all([
        supabase.from('social_posts').select('id,brand_id,title,status,current_revision_id,approved_revision_id,approved_at,updated_at')
          .eq('brand_id', brands.id).order('updated_at', { ascending: false }),
        supabase.from('social_post_revisions').select('id,post_id,revision_no,platform,caption,image_brief'),
      ]);
      if (postResult.error) throw postResult.error;
      if (revisionResult.error) throw revisionResult.error;
      setBrand(brands as Brand);
      setPosts((postResult.data || []) as Post[]);
      setRevisions((revisionResult.data || []) as Revision[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Social Studio could not load. The database migration may still be pending.');
    } finally {
      setLoading(false);
    }
  }, [liveWorkspace]);

  useEffect(() => { void load(); }, [load]);

  const selectedPost = posts.find((post) => post.id === selectedId) || null;
  const selectedRevision = revisions.find((revision) => revision.id === selectedPost?.current_revision_id) || null;
  const counts = useMemo(() => ({
    draft: posts.filter((post) => post.status === 'draft').length,
    inReview: posts.filter((post) => post.status === 'in_review').length,
    approved: posts.filter((post) => post.status === 'approved').length,
  }), [posts]);

  function selectPost(post: Post) {
    const revision = revisions.find((item) => item.id === post.current_revision_id);
    setSelectedId(post.id);
    setDraft({
      title: post.title,
      caption: revision?.caption || '',
      platform: revision?.platform || 'facebook',
      imageBrief: revision?.image_brief || '',
    });
    setError(null);
    setNotice(null);
  }

  function newPost() {
    setSelectedId(null);
    setDraft(emptyDraft);
    setError(null);
    setNotice(null);
  }

  async function run(operation: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await load();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: React.FormEvent) {
    event.preventDefault();
    const client = supabase;
    if (!liveWorkspace || !client || !brand || !draft.title.trim() || !draft.caption.trim()) return;
    await run(async () => {
      if (selectedPost) {
        if (!selectedRevision) throw new Error('The current revision is unavailable. Refresh and try again.');
        if (draft.title.trim() !== selectedPost.title) {
          throw new Error('The post title cannot be changed in this first release.');
        }
        const { error: reviseError } = await client.rpc('social_revise_post', {
          p_post_id: selectedPost.id,
          p_expected_revision_id: selectedRevision.id,
          p_caption: draft.caption.trim(),
          p_platform: draft.platform,
          p_image_brief: draft.imageBrief.trim(),
        });
        if (reviseError) throw reviseError;
      } else {
        const { data, error: createError } = await client.rpc('social_create_post', {
          p_brand_id: brand.id,
          p_title: draft.title.trim(),
          p_caption: draft.caption.trim(),
          p_platform: draft.platform,
          p_image_brief: draft.imageBrief.trim(),
        });
        if (createError) throw createError;
        setSelectedId(data as string);
      }
    }, selectedPost ? 'New revision saved. Approval must be requested again.' : 'Draft saved.');
  }

  async function changeStatus(action: 'social_submit_post' | 'social_approve_post' | 'social_request_changes') {
    const client = supabase;
    if (!liveWorkspace || !client || !selectedPost || !selectedRevision) return;
    if (action === 'social_approve_post' && !window.confirm(`Approve revision ${selectedRevision.revision_no} for ${selectedRevision.platform}?`)) return;
    const messages = {
      social_submit_post: 'Draft sent for review.',
      social_approve_post: 'This exact revision is approved. Publishing is not connected yet.',
      social_request_changes: 'Changes requested. The post is back in drafts.',
    };
    await run(async () => {
      const { error: actionError } = await client.rpc(action, {
        p_post_id: selectedPost.id, p_revision_id: selectedRevision.id,
      });
      if (actionError) throw actionError;
    }, messages[action]);
  }

  return <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Manuscript Heaven</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">Social Studio</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Prepare and approve posts here. Account connection and scheduled publishing will be added after the draft workflow is verified.</p>
      </div>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 px-3 py-2 text-sm" disabled={loading || busy}>
        <RefreshCw size={16} /> Refresh
      </button>
    </div>

    <div className="grid grid-cols-3 gap-3">
      {([['Drafts', counts.draft], ['In review', counts.inReview], ['Approved', counts.approved]] as const).map(([label, value]) =>
        <div key={label} className="rounded-2xl border border-stone-200 bg-white p-3 sm:p-5">
          <div className="text-xs text-muted sm:text-sm">{label}</div><div className="mt-1 text-xl font-semibold text-ink">{value}</div>
        </div>)}
    </div>

    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

    <div className="grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.7fr)]">
      <section className="rounded-2xl border border-stone-200 bg-white p-4" aria-label="Post drafts">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-ink">Posts</h2>
          <button type="button" onClick={newPost} className="rounded-lg bg-ink px-3 py-2 text-xs font-medium text-white">New draft</button>
        </div>
        {loading ? <p className="text-sm text-muted">Loading drafts…</p> : posts.length === 0 ? <p className="text-sm text-muted">No posts yet. Create your first draft.</p> :
          <div className="space-y-2">{posts.map((post) =>
            <button type="button" key={post.id} onClick={() => selectPost(post)}
              className={`w-full rounded-xl border p-3 text-left ${selectedId === post.id ? 'border-amber-600 bg-amber-50' : 'border-stone-200 hover:bg-stone-50'}`}>
              <span className="block truncate text-sm font-medium text-ink">{post.title}</span>
              <span className="mt-1 block text-xs capitalize text-muted">{post.status.replace('_', ' ')} · {new Date(post.updated_at).toLocaleDateString()}</span>
            </button>)}</div>}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6" aria-label="Post editor">
        <div className="mb-4 flex items-center gap-2"><FilePenLine size={18} /><h2 className="font-semibold text-ink">{selectedPost ? 'Post revision' : 'New draft'}</h2></div>
        <form onSubmit={(event) => void saveDraft(event)} className="space-y-4">
          <label className="block text-sm font-medium text-ink">Working title
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} disabled={!!selectedPost || busy}
              maxLength={160} required className="mt-1 w-full rounded-xl border border-stone-300 bg-white p-3 text-sm disabled:bg-stone-100" />
          </label>
          <label className="block text-sm font-medium text-ink">Platform draft
            <select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value as Platform })} disabled={busy}
              className="mt-1 w-full rounded-xl border border-stone-300 bg-white p-3 text-sm">
              <option value="facebook">Facebook Page</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-ink">Caption
            <textarea value={draft.caption} onChange={(event) => setDraft({ ...draft, caption: event.target.value })} disabled={busy}
              rows={8} maxLength={5000} required className="mt-1 w-full rounded-xl border border-stone-300 p-3 text-sm" />
          </label>
          <label className="block text-sm font-medium text-ink">Visual brief (optional)
            <textarea value={draft.imageBrief} onChange={(event) => setDraft({ ...draft, imageBrief: event.target.value })} disabled={busy}
              rows={3} maxLength={2000} className="mt-1 w-full rounded-xl border border-stone-300 p-3 text-sm" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || loading || !brand} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {selectedPost ? 'Save new revision' : 'Save draft'}
            </button>
            {selectedPost && selectedRevision && <span className="text-xs text-muted">Revision {selectedRevision.revision_no} · {selectedPost.status.replace('_', ' ')}</span>}
          </div>
        </form>

        {selectedPost && selectedRevision && <div className="mt-6 flex flex-wrap gap-2 border-t border-stone-200 pt-5">
          {selectedPost.status === 'draft' && <button type="button" disabled={busy} onClick={() => void changeStatus('social_submit_post')}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-300 px-4 py-2 text-sm"><Send size={15} /> Request review</button>}
          {selectedPost.status === 'in_review' && <>
            <button type="button" disabled={busy} onClick={() => void changeStatus('social_approve_post')}
              className="inline-flex items-center gap-2 rounded-xl bg-green-800 px-4 py-2 text-sm text-white"><ShieldCheck size={15} /> Approve revision</button>
            <button type="button" disabled={busy} onClick={() => void changeStatus('social_request_changes')}
              className="rounded-xl border border-stone-300 px-4 py-2 text-sm">Request changes</button>
          </>}
          {selectedPost.status === 'approved' && <span className="inline-flex items-center gap-2 text-sm text-green-800"><CheckCircle2 size={16} /> Approved for review workflow only</span>}
        </div>}
      </section>
    </div>
  </div>;
}
