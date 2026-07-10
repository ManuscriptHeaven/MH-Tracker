import { BookOpen, LockKeyhole, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button, Card, Field } from '../components/ui';
import { roleLabels } from '../lib/constants';
import { isSupabaseConfigured } from '../lib/supabase';
import type { Role } from '../lib/types';

export function LoginPage({
  onLogin,
  onDemoLogin,
  error,
  isLoading,
}: {
  onLogin: (loginName: string, password: string) => Promise<void>;
  onDemoLogin: (role: Role) => void;
  error: string | null;
  isLoading: boolean;
}) {
  const [loginName, setLoginName] = useState(isSupabaseConfigured ? '' : 'Tahir');
  const [password, setPassword] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onLogin(loginName, password);
    } catch {
      // The tracker hook stores the readable error message for the form.
    }
  }

  return (
    <main className="grid min-h-screen bg-linen p-4 lg:grid-cols-[0.9fr_1.1fr] lg:p-0">
      <section className="hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-md bg-gold text-ink font-display text-xl font-bold">
            MH
          </div>
          <div>
            <p className="font-display text-2xl font-semibold">Manuscript Heaven</p>
            <p className="text-xs uppercase tracking-[0.24em] text-gold">Publishing Operations</p>
          </div>
        </div>

        <div className="max-w-xl">
          <div className="mb-6 grid h-16 w-16 place-items-center rounded-lg border border-gold/30 bg-white/10">
            <BookOpen className="h-8 w-8 text-gold" />
          </div>
          <h1 className="font-display text-5xl font-semibold leading-tight">
            Keep every manuscript, proof, revision, and delivery on track.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/70">
            A lightweight internal dashboard for assigning book projects, tracking deadlines, and helping the team move work from files received to final delivery.
          </p>
        </div>

        <p className="text-sm text-white/50">Free-hosting friendly: React, Vite, Supabase, and Cloudflare Pages.</p>
      </section>

      <section className="grid place-items-center">
        <Card className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-gold/20 text-gold">
              <LockKeyhole className="h-7 w-7" />
            </div>
            <h2 className="font-display text-3xl font-semibold">Team Login</h2>
            <p className="mt-2 text-sm text-muted">
              {isSupabaseConfigured
                ? 'Sign in with your first name and password.'
                : 'Supabase keys are not set yet, so you can preview with demo users.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="Name"
              type="text"
              placeholder="First name, for example Tahir"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              required
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required={isSupabaseConfigured}
            />
            {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={isLoading}>
              <UserRound className="h-4 w-4" />
              {isLoading ? 'Signing in' : 'Sign In'}
            </Button>
          </form>

          {!isSupabaseConfigured ? (
            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-3 text-sm font-semibold text-muted">Preview as</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['admin', 'project_manager', 'employee', 'junior_assistant', 'client'] as Role[]).map((role) => (
                  <button
                    key={role}
                    onClick={() => onDemoLogin(role)}
                    className="rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold transition hover:border-gold hover:bg-ivory"
                  >
                    {roleLabels[role]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      </section>
    </main>
  );
}
