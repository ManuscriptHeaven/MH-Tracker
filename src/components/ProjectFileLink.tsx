import { useRef, useState, type ReactNode } from 'react';
import { projectFileLocation } from '../lib/stageSubmission';

export type ProjectFileResolver = (value: string, projectId: string) => Promise<string>;

/** Persist stable private references; generate expiring links only when opening. */
export function ProjectFileLink({ url, projectId, resolve, children, className, title }: {
  url: string; projectId: string; resolve?: ProjectFileResolver; children: ReactNode; className?: string; title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const location = projectFileLocation(url, projectId);
  if (location?.kind === 'external') return <a href={location.url} target="_blank" rel="noopener noreferrer" className={className} title={title}>{children}</a>;
  return <span className="min-w-0">
    <button type="button" className={className} title={title} disabled={busy || !location || !resolve} onClick={async () => {
      if (busyRef.current || !resolve) return;
      busyRef.current = true; setBusy(true); setError(null);
      const popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
      try {
        const signedUrl = await resolve(url, projectId);
        if (projectFileLocation(signedUrl)?.kind !== 'external') throw new Error('The file link is invalid.');
        if (popup) popup.location.href = signedUrl;
        else setError('Allow popups, then open the file again.');
      } catch (failure) {
        popup?.close();
        setError(failure instanceof Error ? failure.message : 'Could not open this file.');
      } finally { busyRef.current = false; setBusy(false); }
    }}>{busy ? 'Opening…' : children}</button>
    {!location && <span className="block text-xs text-red-800">Invalid file link</span>}
    {error && <span role="alert" className="block text-xs text-red-800">{error}</span>}
  </span>;
}
