import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Copy, Edit3, Megaphone, Plus, RefreshCw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SocialEditorialCalendar } from '../components/social/SocialEditorialCalendar';
import { SocialArtworkLibrary } from '../components/social/SocialArtworkLibrary';
import { FacebookPublishingPanel } from '../components/social/FacebookPublishingPanel';
import type { SocialArtwork } from '../components/social/SocialArtworkLibrary';
import type { Profile } from '../lib/types';

type Brand = { id: string; name: string; brief: string; owner_id: string };
type Post = { id: string; brand_id: string; owner_id: string; created_at: string };
type Revision = {
  id: string; post_id: string; revision_number: number; caption: string;
  image_brief: string; content_origin: 'manual' | 'ai_suggested'; asset_id: string | null; created_at: string;
};
type Platform = 'facebook' | 'instagram' | 'linkedin';
type Suggestion = {
  caption: string; hashtags: string[]; imageBrief: string;
  variants: Record<Platform, string>; reviewNotes: string; model: string;
  hook?: string; altText?: string; slides?: string[];
};
const PLATFORM_LIMITS: Record<Platform, number> = { facebook: 5000, instagram: 2200, linkedin: 3000 };
const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English' },
  { id: 'roman_ur', label: 'Roman Urdu' },
  { id: 'ur', label: 'Urdu (اردو)' },
  { id: 'bilingual', label: 'English + Roman Urdu' },
];
const TONE_OPTIONS = [
  { id: 'educational', label: 'Educational' },
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'promotional', label: 'Promotional' },
  { id: 'storytelling', label: 'Storytelling' },
];
const POST_TYPE_OPTIONS = [
  { id: 'tip', label: 'Quick tip' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'myth_fact', label: 'Myth vs fact' },
  { id: 'carousel', label: 'Carousel (slides)' },
  { id: 'before_after', label: 'Before / after' },
  { id: 'question', label: 'Engagement question' },
  { id: 'promo', label: 'Service promotion' },
];
const LENGTH_OPTIONS = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
];
export function composeCaption(text: string, hashtags: string[]): string {
  const extra = hashtags.filter(tag => !text.toLowerCase().includes(tag.toLowerCase())).join(' ');
  return [text.trim(), extra].filter(Boolean).join('\n\n').slice(0, 8000);
}
export function parseHashtagInput(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/[\s,]+/).map(tag => tag.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(tag => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()))
    .slice(0, 30).map(tag => '#' + tag);
}
const TOPIC_STARTERS = [
  'Why running headers are omitted on chapter opening pages',
  '300 DPI images versus low-resolution images in print',
  'How to check a reflowable EPUB table of contents',
  'Print PDF versus Kindle EPUB: what changes in book formatting',
  'How to choose a professional font pairing for a memoir',
  'Widows, orphans and consistent book typesetting',
];
const BRAND_BRIEF_TEMPLATE = [
  'Business: Manuscript Heaven. Services: Adobe InDesign interior book formatting,',
  'novels, memoirs and nonfiction layouts, KDP print-ready interior PDFs,',
  'reflowable Kindle EPUBs with clickable TOC, print covers and print preflight.',
  'Audience: indie authors, self-publishers and small publishing teams.',
  'Tone: professional, clear, educational, helpful and confident without exaggeration.',
  'Visual system: clean cream/ink/gold manuscript-inspired typography; 1080x1350 artwork;',
  'accurate typographic comparisons and no invented photos or client logos.',
  'Avoid: promises of guaranteed approval, invented client testimonials,',
  'publication statistics, unverified platform rules, client private content or manuscripts.',
  'CTA: invite authors to ask Manuscript Heaven about book formatting.',
].join(' ');
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
  const [draftImageBrief, setDraftImageBrief] = useState('');
  const [draftAssetId, setDraftAssetId] = useState<string | null>(null);
  const [editedAssetId, setEditedAssetId] = useState<string | null>(null);
  const [artwork, setArtwork] = useState<SocialArtwork[]>([]);
  const [artworkPreviews, setArtworkPreviews] = useState<Record<string, string>>({});
  const [draftOrigin, setDraftOrigin] = useState<'manual' | 'ai_suggested'>('manual');
  const [brandBrief, setBrandBrief] = useState('');
  const [topic, setTopic] = useState(TOPIC_STARTERS[0]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestionPlatform, setSuggestionPlatform] = useState<Platform>('facebook');
  const [generating, setGenerating] = useState(false);
  const [language, setLanguage] = useState('en');
  const [tone, setTone] = useState('educational');
  const [postType, setPostType] = useState('tip');
  const [postLength, setPostLength] = useState('medium');
  const [keyPoints, setKeyPoints] = useState('');
  const [callToAction, setCallToAction] = useState('');
  const [hashtagText, setHashtagText] = useState('');
  const [variantEdits, setVariantEdits] = useState<Partial<Record<Platform, string>>>({});
  const [channel, setChannel] = useState('facebook');
  const [editing, setEditing] = useState<string | null>(null);
  const [editedCaption, setEditedCaption] = useState('');
  const [editedImageBrief, setEditedImageBrief] = useState('');
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
        supabase.from('social_post_revisions').select('id,post_id,revision_number,caption,image_brief,content_origin,asset_id,created_at'),
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
  const selectedSavedBrief = brands.find(item => item.id === selectedBrand)?.brief || '';
  useEffect(() => {
    setBrandBrief(selectedSavedBrief);
  }, [selectedBrand, selectedSavedBrief]);
  useEffect(() => { setSuggestion(null); }, [selectedBrand]);
  useEffect(() => { setDraftAssetId(null); setEditedAssetId(null); }, [selectedBrand]);

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

  const visibleFeed = selectedBrand ? feed.filter(item => item.post.brand_id === selectedBrand) : feed;
  const counts = {
    drafts: visibleFeed.filter(item => item.target.status === 'draft').length,
    review: visibleFeed.filter(item => item.target.status === 'in_review').length,
    approved: visibleFeed.filter(item => item.target.status === 'approved').length,
    scheduled: visibleFeed.filter(item => item.target.status === 'scheduled').length,
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
      const { error: err } = await supabase!.rpc('social_create_media_draft', {
        p_brand_id: selectedBrand, p_caption: caption.trim(), p_channel: channel,
        p_image_brief: draftImageBrief.trim(), p_content_origin: draftOrigin,
        p_asset_id: draftAssetId,
      });
      if (err) throw err;
      setCaption('');
      setDraftImageBrief('');
      setDraftOrigin('manual');
      setDraftAssetId(null);
    }, 'Post draft, creative brief and selected image saved securely.');
  }

  async function saveRevision(postId: string) {
    if (!editedCaption.trim() || !supabase) return;
    await run(async () => {
      const { error: err } = await supabase!.rpc('social_append_media_revision', {
        p_post_id: postId, p_caption: editedCaption.trim(),
        p_image_brief: editedImageBrief.trim(), p_content_origin: 'manual',
        p_asset_id: editedAssetId,
      });
      if (err) throw err;
      setEditing(null);
      setEditedCaption('');
      setEditedImageBrief('');
      setEditedAssetId(null);
    }, 'New revision including artwork saved; previous approval and schedule cleared.');
  }

  async function transition(target: Target, updates: Record<string, unknown>, success: string) {
    if (!supabase) return;
    await run(async () => {
      const { error: err } = await supabase!.from('social_post_targets')
        .update(updates).eq('id', target.id).eq('owner_id', currentProfile.id).select('id').single();
      if (err) throw err;
    }, success);
  }

  async function saveBrandBrief() {
    if (!selectedBrand || !supabase) return;
    await run(async () => {
      const { error: err } = await supabase!.from('social_brands')
        .update({ brief: brandBrief.trim() })
        .eq('id', selectedBrand).eq('owner_id', currentProfile.id)
        .select('id').single();
      if (err) throw err;
    }, 'Brand brief saved. AI will use only this approved marketing guidance.');
  }

  const savedBrandBrief = brands.find(b => b.id === selectedBrand)?.brief || '';
  const briefIsSaved = !!brandBrief.trim() && savedBrandBrief.trim() === brandBrief.trim();

  async function generateSuggestion(regenerate = false) {
    if (!supabase || !selectedBrand || !topic.trim() || !briefIsSaved) {
      setError('Save the approved brand brief before requesting AI content.');
      return;
    }
    if (topic.trim().length < 4) {
      setError('Write a topic of at least 4 characters.');
      return;
    }
    const previous = regenerate && suggestion ? suggestion.caption.slice(0, 1500) : '';
    setGenerating(true);
    setError('');
    setMessage('');
    try {
      const { data, error: err } = await supabase.functions.invoke('social-draft', {
        body: {
          brandId: selectedBrand, topic: topic.trim(), platform: channel,
          language, tone, postType, length: postLength,
          keyPoints: keyPoints.trim(), callToAction: callToAction.trim(),
          avoidRepeating: previous,
        },
      });
      if (err) {
        let reason = err.message;
        try {
          const context = (err as { context?: Response }).context;
          if (context && 'json' in context) {
            const payload: { error?: string } = await context.json();
            if (payload?.error) reason = payload.error;
          }
        } catch { /* Keep generic error if the provider response is unavailable. */ }
        throw new Error(reason);
      }
      const output = data as Suggestion | null;
      if (!output || typeof output.caption !== 'string' || !output.variants
        || !Array.isArray(output.hashtags) || typeof output.imageBrief !== 'string') {
        throw new Error('AI returned an unexpected response. Please retry.');
      }
      setSuggestion(output);
      setVariantEdits({});
      setHashtagText(output.hashtags.join(' '));
      setSuggestionPlatform(channel as Platform);
      setMessage(regenerate ? 'New version generated. Review all claims before saving.'
        : 'AI generated an editable suggestion. Review all claims before saving.');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setGenerating(false);
    }
  }

  function variantText(platform: Platform): string {
    if (!suggestion) return '';
    return variantEdits[platform] ?? (suggestion.variants[platform] || suggestion.caption);
  }

  function suggestionBrief(): string {
    if (!suggestion) return '';
    const parts = [suggestion.imageBrief];
    if (suggestion.slides?.length) parts.push('Carousel slides:\n' + suggestion.slides.map((s, i) => (i + 1) + '. ' + s).join('\n'));
    if (suggestion.altText) parts.push('Alt text: ' + suggestion.altText);
    return parts.filter(Boolean).join('\n\n').slice(0, 2400);
  }

  function useSuggestion() {
    if (!suggestion) return;
    setCaption(composeCaption(variantText(suggestionPlatform), parseHashtagInput(hashtagText)));
    setDraftImageBrief(suggestionBrief());
    setDraftOrigin('ai_suggested');
    setChannel(suggestionPlatform);
    setMessage('Suggestion copied into the editable draft. Review it, then press Save Draft.');
    setSuggestion(null);
    document.getElementById('social-draft-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveAllPlatformDrafts() {
    if (!suggestion || !selectedBrand || !supabase) return;
    const tags = parseHashtagInput(hashtagText);
    const brief = suggestionBrief();
    await run(async () => {
      for (const platform of CHANNELS.map(item => item.id as Platform)) {
        const { error: err } = await supabase!.rpc('social_create_media_draft', {
          p_brand_id: selectedBrand, p_caption: composeCaption(variantText(platform), tags),
          p_channel: platform, p_image_brief: brief, p_content_origin: 'ai_suggested',
          p_asset_id: draftAssetId,
        });
        if (err) throw err;
      }
      setSuggestion(null);
    }, 'Three AI drafts saved (Facebook, Instagram, LinkedIn). Review each one in the Content Pipeline below.');
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(label + ' copied.');
    } catch {
      setError('Clipboard not available. Select and copy the text manually.');
    }
  }

  async function copyVisualBrief(brief: string) {
    try {
      await navigator.clipboard.writeText(brief);
      setMessage('Visual design brief copied.');
    } catch {
      setError('Clipboard not available. Select and copy the visual brief manually.');
    }
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
          <strong>Live pilot · planning only.</strong> Private artwork, AI-assisted drafts and the Facebook connection flow are available to admins.
          Scheduled items create reviewable test jobs and are <strong>not automatically published</strong>. All real Facebook publishing remains disabled pending separate certification.
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
          {selectedBrand && <div className="space-y-2 border-t border-border pt-4">
            <label className="block text-sm font-medium text-ink">
              Approved marketing brief
              <textarea value={brandBrief} rows={7} maxLength={3500}
                onChange={e => setBrandBrief(e.target.value)}
                placeholder="Describe your services, tone, audience, brand visual style, and claims to avoid."
                className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm" />
            </label>
            <button type="button" onClick={() => setBrandBrief(BRAND_BRIEF_TEMPLATE)}
              className="text-xs font-semibold text-gold hover:underline">Use MH starter brief (edit before saving)</button>
            <button onClick={() => void saveBrandBrief()}
              disabled={busy || generating || !brandBrief.trim() || briefIsSaved}
              className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
              Save approved brief
            </button>
            <p className="text-xs text-muted">Only save public, authorized brand information. Never include a client's unpublished manuscript.</p>
          </div>}
        </section>

        <section id="social-draft-editor" className="scroll-mt-24 space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm lg:col-span-3">
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
            <textarea value={caption} onChange={e => { setCaption(e.target.value); setDraftOrigin('manual'); }} maxLength={8000}
              placeholder="Share a publishing tip, client-safe case study, or book formatting insight..."
              rows={5} className="mt-2 w-full resize-y rounded-lg border border-border p-3 text-sm" />
          </label>
          <label className="block text-sm font-medium text-ink">
            Visual design brief (saved with this revision)
            <textarea value={draftImageBrief} onChange={e => setDraftImageBrief(e.target.value)}
              maxLength={2400} rows={3} placeholder="Suggested layout, typography, colors, imagery and graphic comparisons..."
              className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm" />
          </label>
          {draftAssetId && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-linen p-3">
            {artworkPreviews[draftAssetId] &&
              <img src={artworkPreviews[draftAssetId]} alt="Selected private unpublished artwork"
                className="h-20 w-16 rounded object-contain" />}
            <span className="text-xs font-semibold text-ink">Private artwork selected for this draft</span>
            <button type="button" onClick={() => setDraftAssetId(null)}
              className="text-xs font-semibold text-red-700 hover:underline">Remove from draft</button>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={caption.length > (PLATFORM_LIMITS[channel as Platform] || 8000)
              ? 'text-xs font-semibold text-red-700' : 'text-xs text-muted'}>
              {caption.length} / {(PLATFORM_LIMITS[channel as Platform] || 8000).toLocaleString()} characters
              {caption.length > (PLATFORM_LIMITS[channel as Platform] || 8000) ? ' — too long for this platform' : ''}
            </span>
            <button onClick={() => void createDraft()} disabled={busy || !caption.trim() || !selectedBrand}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
              <Plus className="h-4 w-4" /> Save Draft
            </button>
          </div>
        </section>
      </div>

      <SocialEditorialCalendar
        brandId={selectedBrand}
        entries={feed.map(item => ({
          id: item.target.id,
          brandId: item.post.brand_id,
          channel: item.target.channel,
          status: item.target.status,
          caption: item.revision?.caption || '',
          scheduledAt: item.target.scheduled_at,
        }))}
        onChooseTopic={selectedTopic => {
          setTopic(selectedTopic);
          setSuggestion(null);
          setMessage('Topic selected. Review the approved brand brief, then generate content.');
          document.getElementById('social-ai-content-generator')?.scrollIntoView({
            behavior: 'smooth', block: 'start',
          });
        }}
      />

      <section id="social-ai-content-generator" className="scroll-mt-24 space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5 text-gold" />
          <h2 className="text-lg font-bold text-ink">AI Content Generator</h2>
          <span className="rounded-full border border-border bg-linen px-2 py-1 text-[11px] font-semibold text-muted">Requires approval</span>
        </div>
        <p className="text-sm text-muted">Generate a post in your language and tone, with hashtags, Facebook/Instagram/LinkedIn versions and an artwork brief. Nothing is saved or published until you save a draft.</p>
        <div className="flex flex-wrap gap-2">
          {TOPIC_STARTERS.map(item =>
            <button key={item} type="button" onClick={() => setTopic(item)}
              className={topic === item
                ? 'rounded-full border border-ink bg-ink px-3 py-2 text-xs font-medium text-white'
                : 'rounded-full border border-border px-3 py-2 text-xs font-medium text-ink hover:bg-linen'}>{item}</button>)}
        </div>
        <label className="block text-sm font-medium text-ink">
          Post topic or educational angle
          <input value={topic} onChange={e => setTopic(e.target.value)} maxLength={200}
            placeholder="e.g., What is a running header in a nonfiction book?"
            className="mt-2 w-full rounded-lg border border-border p-3 text-sm" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Language', value: language, set: setLanguage, options: LANGUAGE_OPTIONS },
            { label: 'Tone', value: tone, set: setTone, options: TONE_OPTIONS },
            { label: 'Post type', value: postType, set: setPostType, options: POST_TYPE_OPTIONS },
            { label: 'Length', value: postLength, set: setPostLength, options: LENGTH_OPTIONS },
            { label: 'Main platform', value: channel, set: setChannel, options: CHANNELS },
          ].map(field => (
            <label key={field.label} className="block text-xs font-semibold text-muted">
              {field.label}
              <select value={field.value} onChange={e => field.set(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-white p-2.5 text-sm text-ink">
                {field.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-muted">
            Key points to include (optional)
            <textarea value={keyPoints} onChange={e => setKeyPoints(e.target.value)} maxLength={600} rows={2}
              placeholder="e.g., mention 24-hour delivery for small books, InDesign + KDP ready files"
              className="mt-1 w-full rounded-lg border border-border p-2.5 text-sm text-ink" />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Call to action (optional)
            <textarea value={callToAction} onChange={e => setCallToAction(e.target.value)} maxLength={160} rows={2}
              placeholder="e.g., DM us for a free formatting quote"
              className="mt-1 w-full rounded-lg border border-border p-2.5 text-sm text-ink" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || generating || !selectedBrand || !briefIsSaved || topic.trim().length < 4}
            onClick={() => void generateSuggestion(false)}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
            <Sparkles className="h-4 w-4" /> {generating ? 'Generating suggestions...' : 'Generate AI Content'}
          </button>
          {suggestion &&
            <button disabled={busy || generating} onClick={() => void generateSuggestion(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-semibold text-ink disabled:opacity-40">
              <RefreshCw className="h-4 w-4" /> Try a different version
            </button>}
        </div>
        {!briefIsSaved && selectedBrand &&
          <p className="text-xs text-amber-800">Save or update your approved brand brief above before using AI generation.</p>}
        {generating && !suggestion &&
          <div className="animate-pulse rounded-xl border border-border bg-linen p-4 text-sm text-muted">Writing your post… this usually takes 5–15 seconds.</div>}
        {suggestion && (
          <div className="space-y-4 rounded-xl border border-gold/30 bg-linen p-4">
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map(item => {
                const length = variantText(item.id as Platform).length;
                const over = length > PLATFORM_LIMITS[item.id as Platform];
                return (
                  <button type="button" key={item.id}
                    onClick={() => setSuggestionPlatform(item.id as Platform)}
                    className={suggestionPlatform === item.id
                      ? 'rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white'
                      : 'rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-ink'}>
                    {item.label} <span className={over ? 'text-red-400' : 'opacity-60'}>· {length}</span>
                  </button>
                );
              })}
            </div>
            <label className="block">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {CHANNELS.find(c => c.id === suggestionPlatform)?.label} caption — edit here before saving
                </span>
                <button type="button"
                  onClick={() => void copyText(composeCaption(variantText(suggestionPlatform), parseHashtagInput(hashtagText)), 'Caption with hashtags')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gold">
                  <Copy className="h-3.5 w-3.5" /> Copy caption</button>
              </div>
              <textarea value={variantText(suggestionPlatform)} rows={8} maxLength={PLATFORM_LIMITS[suggestionPlatform]}
                dir={language === 'ur' ? 'rtl' : 'auto'}
                onChange={e => setVariantEdits(prev => ({ ...prev, [suggestionPlatform]: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm leading-relaxed text-ink" />
              <span className={variantText(suggestionPlatform).length > PLATFORM_LIMITS[suggestionPlatform] - 50
                ? 'text-xs font-semibold text-red-700' : 'text-xs text-muted'}>
                {variantText(suggestionPlatform).length} / {PLATFORM_LIMITS[suggestionPlatform].toLocaleString()} characters
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Hashtags (edit, separate with spaces)</span>
              <input value={hashtagText} onChange={e => setHashtagText(e.target.value)} maxLength={600}
                className="mt-1 w-full rounded-lg border border-border bg-white p-2.5 text-sm text-ink" />
            </label>
            {!!suggestion.slides?.length && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Carousel slides</div>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink">
                  {suggestion.slides.map((slide, index) => <li key={index}>{slide}</li>)}
                </ol>
              </div>
            )}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Artwork brief · 1080 × 1350</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{suggestion.imageBrief}</p>
              {suggestion.altText && <p className="mt-1 text-xs text-muted"><strong>Alt text:</strong> {suggestion.altText}</p>}
              <div className="mt-2 flex flex-wrap gap-3">
                <button type="button" onClick={() => void copyVisualBrief(suggestionBrief())}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gold">
                  <Copy className="h-3.5 w-3.5" /> Copy artwork brief</button>
                <button type="button" onClick={() => {
                    setDraftImageBrief(suggestionBrief());
                    document.getElementById('social-artwork-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gold">
                  <Sparkles className="h-3.5 w-3.5" /> Send brief to artwork generator</button>
              </div>
            </div>
            {suggestion.reviewNotes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>Human review:</strong> {suggestion.reviewNotes}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={useSuggestion}
                className="rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white">
                Use in draft editor</button>
              <button type="button" onClick={() => void saveAllPlatformDrafts()} disabled={busy || generating}
                className="inline-flex items-center gap-2 rounded-lg border border-ink px-4 py-3 text-sm font-bold text-ink disabled:opacity-40">
                <Plus className="h-4 w-4" /> Save drafts for all 3 platforms</button>
              <button type="button" onClick={() => setSuggestion(null)}
                className="rounded-lg border border-border px-4 py-3 text-sm font-semibold text-ink">
                Discard suggestion</button>
            </div>
            <p className="text-[11px] text-muted">Model: {suggestion.model}. AI drafts still need Submit for review → Approve before planning.</p>
          </div>
        )}
      </section>

      <FacebookPublishingPanel
        brandId={selectedBrand}
        adminId={currentProfile.id}
        targets={visibleFeed.map(item => ({
          id: item.target.id,
          brandId: item.post.brand_id,
          caption: item.revision?.caption || '',
        }))}
        onAfterRun={() => { void reload(); }}
      />

      <div id="social-artwork-library" className="scroll-mt-24" />
      <SocialArtworkLibrary
        brandId={selectedBrand}
        adminId={currentProfile.id}
        proposedBrief={draftImageBrief || 'Create an original 4:5 educational book-formatting comparison about ' + topic}
        savedBrandBrief={briefIsSaved ? savedBrandBrief : ''}
        selectedAssetId={draftAssetId}
        onChooseAsset={setDraftAssetId}
        onLibraryChanged={(records, urls) => {
          setArtwork(records);
          setArtworkPreviews(urls);
        }}
        onRightsChanged={() => { void reload(); }}
      />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-ink">Content Pipeline</h2>
          <span className="text-sm text-muted">{visibleFeed.length} posts</span>
        </div>
        {loading ? <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted">Loading your Studio...</div>
          : visibleFeed.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted">
              No posts yet. Save your first draft above to start reviewing content.
            </div>
          ) : visibleFeed.map(item => {
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
                    <label className="block text-xs font-semibold text-muted">Visual design brief
                      <textarea rows={3} maxLength={2400} value={editedImageBrief}
                        onChange={e => setEditedImageBrief(e.target.value)}
                        className="mt-2 w-full rounded-lg border border-border p-3 text-sm" />
                    </label>
                    <label className="block text-xs font-semibold text-muted">Artwork for this new revision
                      <select value={editedAssetId || ''} onChange={e => setEditedAssetId(e.target.value || null)}
                        className="mt-2 w-full rounded-lg border border-border bg-white p-2.5 text-sm">
                        <option value="">No artwork</option>
                        {artwork.filter(asset => asset.rights_status === 'cleared'
                          || asset.id === editedAssetId).map(asset => (
                          <option key={asset.id} value={asset.id}>
                            {asset.source === 'ai_generated' ? 'AI image' : 'Uploaded image'} — {asset.id.slice(0, 8)}
                            {asset.rights_status !== 'cleared' ? ' (permission missing)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void saveRevision(item.post.id)} disabled={busy || !editedCaption.trim()}
                        className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save new revision</button>
                      <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel edit</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {r?.asset_id && artworkPreviews[r.asset_id] &&
                      <img src={artworkPreviews[r.asset_id]}
                        alt="Private unpublished image attached to this draft"
                        loading="lazy" className="mt-3 max-h-[280px] max-w-full rounded-xl border border-border object-contain" />}
                    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{r?.caption || '(No caption)'}</p>
                    {r?.image_brief &&
                      <details className="mt-3 rounded-lg border border-border bg-linen p-3 text-sm">
                        <summary className="cursor-pointer font-semibold text-ink">View saved visual brief</summary>
                        <p className="mt-2 whitespace-pre-wrap text-muted">{r.image_brief}</p>
                      </details>}
                    <p className="mt-2 text-xs text-muted">
                      {r?.content_origin === 'ai_suggested' ? 'AI-assisted copy · human review required' : 'Manual draft'}
                    </p>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {!isEditing && t.status !== 'cancelled' &&
                      <button disabled={busy} onClick={() => {
                          setEditing(item.post.id);
                          setEditedCaption(r?.caption || '');
                          setEditedImageBrief(r?.image_brief || '');
                          setEditedAssetId(r?.asset_id || null);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">
                        <Edit3 className="h-3.5 w-3.5" /> Edit
                      </button>}
                    {t.status === 'draft' && !!r &&
                      <button disabled={busy} onClick={() => void transition(t, { status: 'in_review' }, 'Draft sent for review.')}
                        className="rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Submit for review</button>}
                    {t.status === 'in_review' && !!r &&
                      <button disabled={busy || !!(r.asset_id && artwork.find(asset =>
                        asset.id === r.asset_id)?.rights_status !== 'cleared')}
                        onClick={() => void transition(t, {
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
        <Send className="h-3.5 w-3.5" /> Private images and AI artwork require permission clearance. Facebook Page connection is optional; delivery tests never publish. Live posting and analytics are still disabled.
      </footer>
    </div>
  );
}
