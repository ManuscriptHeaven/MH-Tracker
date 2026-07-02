import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-white p-5 shadow-soft', className)}>
      {children}
    </section>
  );
}

export function Button({
  children,
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const variants = {
    primary: 'bg-gold text-ink hover:bg-[#b89757]',
    secondary: 'border border-border bg-white text-ink hover:border-gold hover:text-ink',
    ghost: 'text-muted hover:bg-ivory hover:text-ink',
    danger: 'bg-danger text-white hover:bg-red-700',
  };

  return (
    <button
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  className,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
}) {
  return (
    <button
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-white text-muted transition hover:border-gold hover:text-ink',
        className,
      )}
      title={title}
      aria-label={title}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-ink">
      <span>{label}</span>
      <input
        className={cn(
          'min-h-11 rounded-md border border-border bg-white px-3 text-sm text-ink transition placeholder:text-muted focus:border-gold',
          className,
        )}
        {...props}
      />
    </label>
  );
}

export function SelectField({
  label,
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-ink">
      <span>{label}</span>
      <select
        className={cn(
          'min-h-11 rounded-md border border-border bg-white px-3 text-sm text-ink transition focus:border-gold',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function TextareaField({
  label,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-ink">
      <span>{label}</span>
      <textarea
        className={cn(
          'min-h-28 resize-y rounded-md border border-border bg-white px-3 py-2 text-sm text-ink transition placeholder:text-muted focus:border-gold',
          className,
        )}
        {...props}
      />
    </label>
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = 'max-w-4xl',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
      <section className={cn('max-h-[92vh] w-full overflow-hidden rounded-lg bg-linen shadow-2xl', width)}>
        <header className="flex items-center justify-between border-b border-border bg-white px-5 py-4">
          <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="max-h-[calc(92vh-73px)] overflow-y-auto p-5">{children}</div>
      </section>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <Card className="grid place-items-center py-12 text-center">
      <div className="max-w-md">
        <h3 className="font-display text-2xl font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </Card>
  );
}
