import { CheckCircle2, Clock3, ShieldCheck, X } from 'lucide-react';
import { Button } from './ui';

export function ClientApprovalConfirmDialog({
  title,
  projectTitle,
  actionLabel,
  description,
  isProcessing = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  projectTitle: string;
  actionLabel: string;
  description: string;
  isProcessing?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-ink/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isProcessing) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-approval-confirm-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-linen shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-white px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green-50 text-success">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Client Approval</p>
              <h2 id="client-approval-confirm-title" className="mt-0.5 font-display text-xl font-semibold text-ink">
                {title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close approval confirmation"
            disabled={isProcessing}
            onClick={onCancel}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-white text-muted transition hover:bg-ivory hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-gold/30 bg-[#fff9ec] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Project</p>
            <p className="mt-1 font-display text-lg font-semibold text-ink">{projectTitle}</p>
            <p className="mt-2 text-sm leading-6 text-charcoal">{description}</p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Once confirmed, your approval is recorded and the project workflow moves forward automatically.
            </span>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-800">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={isProcessing}
              onClick={onCancel}
              className="sm:min-w-28"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isProcessing}
              onClick={() => void onConfirm()}
              className="bg-success text-white hover:bg-green-700 sm:min-w-44"
            >
              <CheckCircle2 className="h-4 w-4" />
              {isProcessing ? 'Approving...' : actionLabel}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
