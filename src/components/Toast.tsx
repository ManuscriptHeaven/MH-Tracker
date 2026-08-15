import { useEffect } from 'react';
import { AlertCircle, Bell, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ToastData {
  id?: string;
  title?: string;
  message: string;
  tone?: 'success' | 'error' | 'info';
  projectId?: string | null;
}

export function Toast({
  toast,
  onClose,
  onOpenProject,
}: {
  toast: ToastData | null;
  onClose: () => void;
  onOpenProject?: (projectId: string) => void;
}) {
  useEffect(() => {
    if (!toast) return;

    // Auto-dismiss after 4.5 seconds
    const autoDismissTimer = setTimeout(() => {
      onClose();
    }, 4500);

    // Minimize / dismiss when clicked anywhere on the page
    const handleGlobalClick = () => {
      onClose();
    };

    // Small timeout before registering document listener so the triggering action doesn't immediately dismiss it
    const attachTimer = setTimeout(() => {
      window.addEventListener('pointerdown', handleGlobalClick);
    }, 150);

    return () => {
      clearTimeout(autoDismissTimer);
      clearTimeout(attachTimer);
      window.removeEventListener('pointerdown', handleGlobalClick);
    };
  }, [toast, onClose]);

  if (!toast) return null;

  const tone = toast.tone || 'info';

  const toneStyles = {
    success: 'border-green-200 bg-green-50/95 text-emerald-900 shadow-lg shadow-green-900/5',
    error: 'border-red-200 bg-red-50/95 text-rose-950 shadow-lg shadow-red-900/5',
    info: 'border-gold/40 bg-linen/95 text-ink shadow-lg shadow-gold/10',
  };

  const iconMap = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
    error: <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />,
    info: <Bell className="h-5 w-5 text-gold shrink-0" />,
  };

  return (
    <div className="fixed right-4 top-4 z-[100] max-w-sm w-full animate-in fade-in slide-in-from-top-3 duration-200 pointer-events-auto">
      <div
        role="alert"
        onClick={(e) => {
          // Clicking directly on toast also dismisses
          onClose();
        }}
        className={cn(
          'flex items-start gap-3 rounded-lg border p-4 backdrop-blur-sm transition-all cursor-pointer hover:opacity-90',
          toneStyles[tone],
        )}
      >
        <div className="mt-0.5">{iconMap[tone] || <Info className="h-5 w-5 text-gold shrink-0" />}</div>
        <div className="min-w-0 flex-1">
          {toast.title ? (
            <p className="text-xs font-bold uppercase tracking-wider text-muted mb-0.5">{toast.title}</p>
          ) : null}
          <p className="text-sm font-semibold leading-snug">{toast.message}</p>
          {toast.projectId && onOpenProject ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (toast.projectId) {
                  onOpenProject(toast.projectId);
                  onClose();
                }
              }}
              className="mt-2 inline-flex items-center text-xs font-bold text-gold hover:underline"
            >
              View Project →
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="rounded-md p-1 text-muted hover:bg-black/5 hover:text-ink transition shrink-0"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
