import { DollarSign } from 'lucide-react';

export function CurrencySelector({
  className = '',
  variant = 'default',
}: {
  className?: string;
  variant?: 'default' | 'compact' | 'prominent';
}) {
  if (variant === 'compact') {
    return (
      <div className={`inline-flex items-center rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-ink shadow-2xs ${className}`}>
        USD ($)
      </div>
    );
  }

  if (variant === 'prominent') {
    return (
      <div className={`inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-1.5 shadow-xs ${className}`}>
        <div className="rounded-md bg-gold/15 p-1 text-ink">
          <DollarSign className="h-4 w-4 text-gold" />
        </div>
        <div className="flex flex-col text-left">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted leading-tight">
            Accounting Currency
          </span>
          <span className="text-sm font-bold text-ink">USD ($)</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-ink shadow-2xs ${className}`}>
      <span className="text-xs text-muted">Currency:</span>
      <strong>USD ($)</strong>
    </div>
  );
}
