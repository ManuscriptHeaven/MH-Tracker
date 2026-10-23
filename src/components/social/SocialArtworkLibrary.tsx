import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ImagePlus, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export type SocialArtwork = {
  id: string;
  brand_id: string;
  owner_id: string;
  storage_path: string;
  mime_type: string;
  file_bytes: number;
  source: 'uploaded' | 'ai_generated';
  rights_status: 'pending' | 'cleared' | 'withdrawn';
  permission_basis: 'unverified' | 'original' | 'licensed' | 'ai_generated';
  permission_note: string;
  creative_brief: string;
  created_at: string;
};

export const PRIVATE_SOCIAL_ARTWORK_BUCKET = 'social-artwork-private';
export const MAX_SOCIAL_IMAGE_BYTES = 8388608;

type Props = {
  brandId: string;
  adminId: string;
  proposedBrief: string;
  savedBrandBrief: string;
  selectedAssetId: string | null;
  onChooseAsset: (assetId: string | null) => void;
  onLibraryChanged?: (assets: SocialArtwork[], signedUrls: Record<string, string>) => void;
  onRightsChanged?: () => void;
};

function friendlyError(value: unknown): string {
  return value instanceof Error ? value.message :
    value && typeof value === 'object' && 'message' in value
      ? String((value as { message: unknown }).message)
      : 'The operation could not be completed.';
}

export function SocialArtworkLibrary({
  brandId, adminId, proposedBrief, savedBrandBrief, selectedAssetId,
  onChooseAsset, onLibraryChanged, onRightsChanged,
}: Props) {
  const [assets, setAssets] = useState<SocialArtwork[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [visualBrief, setVisualBrief] = useState(proposedBrief);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [permissionId, setPermissionId] = useState<string | null>(null);
  const [permissionBasis, setPermissionBasis] = useState<'original' | 'licensed' | 'ai_generated'>('original');
  const [permissionNote, setPermissionNote] = useState('');
  const [attested, setAttested] = useState(false);

  const reload = useCallback(async () => {
    const client = supabase;
    if (!client || !brandId) {
      setAssets([]); setSignedUrls({});
      onLibraryChanged?.([], {});
      return;
    }
    setLoading(true);
    try {
      const { data, error: listError } = await client.from('social_assets')
        .select('id,brand_id,owner_id,storage_path,mime_type,file_bytes,source,rights_status,permission_basis,permission_note,creative_brief,created_at')
        .eq('brand_id', brandId).order('created_at', { ascending: false });
      if (listError) throw listError;
      const records = (data || []) as SocialArtwork[];
      const pairs = await Promise.all(records.map(async asset => {
        const { data: urlData, error: urlError } = await client.storage
          .from(PRIVATE_SOCIAL_ARTWORK_BUCKET).createSignedUrl(asset.storage_path, 120);
        return [asset.id, !urlError ? urlData?.signedUrl || '' : ''] as const;
      }));
      const urls = Object.fromEntries(pairs) as Record<string, string>;
      setAssets(records); setSignedUrls(urls);
      onLibraryChanged?.(records, urls);
      setError('');
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setAssets([]); setSignedUrls({});
    void reload();
  }, [reload]);

  useEffect(() => { setVisualBrief(proposedBrief); }, [proposedBrief]);

  async function uploadFile(file: File | undefined) {
    if (!file || !brandId || !supabase || working) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)
      || file.size < 1 || file.size > MAX_SOCIAL_IMAGE_BYTES) {
      setError('Upload PNG, JPEG or WebP artwork up to 8 MB.');
      return;
    }
    setWorking(true); setError(''); setNotice('');
    const id = crypto.randomUUID();
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = [adminId, brandId, id + '.' + extension].join('/');
    try {
      const { error: uploadError } = await supabase.storage
        .from(PRIVATE_SOCIAL_ARTWORK_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase.from('social_assets').insert({
        id, owner_id: adminId, brand_id: brandId, storage_path: path,
        mime_type: file.type, file_bytes: file.size, source: 'uploaded',
        rights_status: 'pending', permission_basis: 'unverified',
      });
      if (metadataError) {
        await supabase.storage.from(PRIVATE_SOCIAL_ARTWORK_BUCKET).remove([path]);
        throw metadataError;
      }
      setNotice('Image saved privately. Confirm its usage permission before selecting it for a post.');
      await reload();
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setWorking(false);
    }
  }

  async function generateArtwork() {
    if (!supabase || !brandId || working || generating) return;
    if (!savedBrandBrief.trim()) {
      setError('Save the approved marketing brand brief before using AI image generation.');
      return;
    }
    if (visualBrief.trim().length < 20) {
      setError('Provide at least 20 characters describing the artwork.');
      return;
    }
    setGenerating(true); setError(''); setNotice('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('social-artwork', {
        body: { brandId, visualBrief: visualBrief.trim() },
      });
      if (fnError) {
        let explanation = fnError.message;
        const context = (fnError as { context?: Response }).context;
        if (context && 'json' in context) {
          try {
            const info: { error?: string } = await context.json();
            if (info.error) explanation = info.error;
          } catch { /* Retain generic error. */ }
        }
        throw new Error(explanation);
      }
      if (!data || typeof data.assetId !== 'string') throw new Error('Unexpected image generator response.');
      setNotice('AI image generated and saved privately. Inspect all typography and mark rights cleared before use.');
      await reload();
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setGenerating(false);
    }
  }

  function openPermission(asset: SocialArtwork) {
    setPermissionId(asset.id);
    setPermissionBasis(asset.source === 'ai_generated' ? 'ai_generated' : 'original');
    setPermissionNote('');
    setAttested(false);
  }

  async function clearPermission() {
    const asset = assets.find(item => item.id === permissionId);
    if (!supabase || !asset || !attested || working) return;
    if (asset.source === 'uploaded' && permissionBasis === 'ai_generated') return;
    if (permissionBasis === 'licensed' && permissionNote.trim().length < 12) {
      setError('Record where the license or client permission can be verified (at least 12 characters).');
      return;
    }
    setWorking(true); setError(''); setNotice('');
    try {
      const { error: updateError } = await supabase.from('social_assets').update({
        rights_status: 'cleared', permission_basis: permissionBasis,
        permission_note: permissionNote.trim(),
      }).eq('id', asset.id).eq('owner_id', adminId).select('id').single();
      if (updateError) throw updateError;
      setPermissionId(null); setAttested(false); setPermissionNote('');
      setNotice('Artwork permission recorded. This image may now be attached to a draft.');
      await reload();
      onRightsChanged?.();
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setWorking(false);
    }
  }

  async function withdrawAsset(asset: SocialArtwork) {
    if (!supabase || working || asset.rights_status === 'withdrawn') return;
    if (!window.confirm('Withdraw permission for this image? Approved and planned posts using it will return to draft.')) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const { error: updateError } = await supabase.from('social_assets')
        .update({ rights_status: 'withdrawn', permission_basis: 'unverified', permission_note: '' })
        .eq('id', asset.id).eq('owner_id', adminId).select('id').single();
      if (updateError) throw updateError;
      if (selectedAssetId === asset.id) onChooseAsset(null);
      setNotice('Permission withdrawn. Any approved posts using this image were returned to draft.');
      await reload();
      onRightsChanged?.();
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setWorking(false);
    }
  }

  if (!brandId) return (
    <div className="rounded-xl border border-border bg-white p-5 text-sm text-muted">
      Create or select a brand to open its private artwork library.
    </div>
  );

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7"
      aria-label="Private social artwork library">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
            <LockKeyhole className="h-5 w-5 text-gold" /> Private Artwork Library
          </h2>
          <p className="mt-1 text-sm text-muted">
            Images are stored privately. Select an image for your next draft only after verifying permission.
          </p>
        </div>
        <button type="button" onClick={() => void reload()} disabled={working || generating || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink disabled:opacity-40">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        AI artwork may contain misspelled text or inaccurate book layouts; check before use.
        The image model produces approximately 4:5 artwork, not guaranteed 1080 × 1350 export.
        Generations can incur API charges. Limit: 2 per 5 minutes, 10 per day.
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <ImagePlus className="h-4 w-4 text-gold" /> Upload artwork
          </label>
          <input type="file" accept="image/png,image/jpeg,image/webp"
            disabled={working || generating} onChange={e => {
              void uploadFile(e.target.files?.[0]); e.target.value = '';
            }} className="block w-full max-w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:font-semibold file:text-white" />
          <p className="mt-2 text-xs text-muted">Use only original or licensed work. Max 8 MB per file.</p>
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-gold" /> Generate AI artwork
          </label>
          <textarea value={visualBrief} rows={3} maxLength={1600}
            onChange={e => setVisualBrief(e.target.value)}
            placeholder="Describe one educational 4:5 visual using the approved Manuscript Heaven style..."
            className="w-full rounded-lg border border-border p-2.5 text-sm" />
          <button type="button" onClick={() => void generateArtwork()}
            disabled={working || generating || !savedBrandBrief.trim() || visualBrief.trim().length < 20}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
            <Sparkles className="h-4 w-4" /> {generating ? 'Generating image...' : 'Generate private image'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
      {loading && <p className="text-sm text-muted">Loading private artwork...</p>}
      {!loading && assets.length === 0 && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">No private artwork yet. Upload an original image or generate a draft above.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {assets.map(asset => (
          <article key={asset.id} className="min-w-0 space-y-3 rounded-xl border border-border p-3">
            <div className="aspect-[4/5] overflow-hidden rounded-lg bg-linen">
              {signedUrls[asset.id]
                ? <img src={signedUrls[asset.id]} alt="Unpublished private marketing artwork draft"
                    loading="lazy" className="h-full w-full object-contain" />
                : <div className="flex h-full items-center justify-center text-xs text-muted">Preview unavailable</div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs font-semibold capitalize text-ink">{asset.source.replace('_',' ')}</span>
              <span className={asset.rights_status === 'cleared'
                ? 'text-xs font-bold text-green-700'
                : asset.rights_status === 'withdrawn'
                  ? 'text-xs font-bold text-red-700'
                  : 'text-xs font-semibold text-amber-800'}>{asset.rights_status}</span>
            </div>
            <p className="line-clamp-2 min-h-[2.4em] break-words text-xs text-muted">
              {asset.creative_brief || 'Uploaded marketing artwork'}
            </p>
            <div className="flex flex-wrap gap-2">
              {asset.rights_status === 'cleared' && (
                <button type="button" onClick={() => onChooseAsset(selectedAssetId === asset.id ? null : asset.id)}
                  className={selectedAssetId === asset.id
                    ? 'rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white'
                    : 'rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink'}>
                  {selectedAssetId === asset.id ? 'Selected ✓' : 'Use in draft'}
                </button>
              )}
              {asset.rights_status === 'pending' && (
                <button type="button" onClick={() => openPermission(asset)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink">
                  <ShieldCheck className="h-3.5 w-3.5" /> Verify rights
                </button>
              )}
              {asset.rights_status !== 'withdrawn' && (
                <button type="button" onClick={() => void withdrawAsset(asset)}
                  disabled={working}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 disabled:opacity-40">
                  <XCircle className="h-3.5 w-3.5" /> Withdraw
                </button>
              )}
            </div>
            {permissionId === asset.id && (
              <div className="space-y-2 rounded-lg border border-gold/30 bg-linen p-3">
                {asset.source === 'uploaded' && <label className="block text-xs font-semibold text-ink">
                  Evidence type
                  <select value={permissionBasis} onChange={e => setPermissionBasis(e.target.value as 'original' | 'licensed')}
                    className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs">
                    <option value="original">Original artwork owned by MH</option>
                    <option value="licensed">Licensed / written use permission</option>
                  </select>
                </label>}
                {permissionBasis === 'licensed' && <textarea rows={3} maxLength={1200} value={permissionNote}
                  onChange={e => setPermissionNote(e.target.value)}
                  placeholder="Permission source, terms and where approval evidence is stored."
                  className="w-full rounded-lg border border-border p-2 text-xs" />}
                <label className="flex items-start gap-2 text-xs text-ink">
                  <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)}
                    className="mt-0.5 shrink-0" />
                  <span>I have checked the rights and visual accuracy, and authorize this artwork for MH marketing drafts.</span>
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void clearPermission()}
                    disabled={!attested || working || (permissionBasis === 'licensed' && permissionNote.trim().length < 12)}
                    className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Clear rights
                  </button>
                  <button type="button" onClick={() => setPermissionId(null)}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-ink">Cancel</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
