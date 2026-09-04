import { BookOpen, Briefcase, CheckCircle2, Crown, KeyRound, LockKeyhole, Palette, ShieldCheck, Sparkles, User, UserRound } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button, Card, Field } from '../components/ui';
import { roleLabels } from '../lib/constants';
import { isSupabaseConfigured } from '../lib/supabase';
import type { Profile, Role } from '../lib/types';

export function LoginPage({
  onLogin,
  onSignUp,
  onDemoLogin,
  error,
  isLoading,
}: {
  onLogin: (loginName: string, password: string) => Promise<void>;
  onSignUp?: (data: {
    fullName: string;
    email: string;
    password: string;
    role: Role;
  }) => Promise<{ profile: Profile | null; requiresConfirmation: boolean }>;
  onDemoLogin: (role: Role) => void;
  error: string | null;
  isLoading: boolean;
}) {
  // Read query params from URL (e.g. ?email=... or ?invite=... or ?setup=...)
  const [initialEmail, setInitialEmail] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const emailParam = params.get('email');
      const tokenParam = params.get('invite') || params.get('setup');
      if (emailParam) {
        setInitialEmail(emailParam);
        setLoginName(emailParam);
      }
      if (tokenParam) {
        setInviteToken(tokenParam);
      }
    }
  }, []);

  const [loginName, setLoginName] = useState(() => (isSupabaseConfigured ? '' : 'Tahir'));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupFullName, setSetupFullName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [activationSuccess, setActivationSuccess] = useState(false);

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      await onLogin(loginName, password);
    } catch {
      // Error is handled in hook
    }
  }

  async function handleActivateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (password.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    try {
      if (onSignUp) {
        await onSignUp({
          fullName: setupFullName || loginName.split('@')[0] || 'Team Member',
          email: loginName,
          password,
          role: 'employee',
        });
        setActivationSuccess(true);
      } else {
        await onLogin(loginName, password);
      }
    } catch (err: any) {
      setFormError(err.message || 'Activation failed. Please contact your manager.');
    }
  }

  return (
    <main className="grid min-h-screen bg-linen p-4 lg:grid-cols-[0.9fr_1.1fr] lg:p-0">
      {/* Left Hero Sidebar */}
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
            A secure, internal operations dashboard for assigning book projects, tracking deadlines, and managing team & client workflows.
          </p>
        </div>

        <div className="flex items-center justify-between text-xs text-white/50">
          <p>Free-hosting friendly: React, Vite, Supabase, and Cloudflare Pages.</p>
          <span className="flex items-center gap-1 text-gold/80">
            <ShieldCheck className="h-4 w-4" />
            Invite-Only Access
          </span>
        </div>
      </section>

      {/* Right Login / Activation Box */}
      <section className="grid place-items-center py-8">
        <Card className="w-full max-w-md shadow-lg border border-border">
          {inviteToken ? (
            /* Invite / Activation Mode */
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                  <KeyRound className="h-7 w-7" />
                </div>
                <h2 className="font-display text-3xl font-semibold">Activate Account</h2>
                <p className="mt-2 text-sm text-muted">
                  You’ve been invited to Manuscript Heaven. Set your password to activate your account.
                </p>
              </div>

              {activationSuccess ? (
                <div className="space-y-4 text-center">
                  <div className="flex items-center justify-center gap-2 rounded-md bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <span>Account activated! Logging you into the dashboard...</span>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleActivateSubmit} className="space-y-4">
                  <Field
                    label="Email Address"
                    type="email"
                    value={loginName}
                    onChange={(event) => setLoginName(event.target.value)}
                    required
                    readOnly={Boolean(initialEmail)}
                    className={initialEmail ? 'bg-ivory cursor-not-allowed text-muted' : ''}
                  />
                  <Field
                    label="Your Name"
                    type="text"
                    placeholder="Enter your full name"
                    value={setupFullName}
                    onChange={(event) => setSetupFullName(event.target.value)}
                    required
                  />
                  <Field
                    label="Create Password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <Field
                    label="Confirm Password"
                    type="password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />

                  {formError ? (
                    <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{formError}</p>
                  ) : null}

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    <KeyRound className="h-4 w-4" />
                    {isLoading ? 'Activating...' : 'Activate & Enter Dashboard'}
                  </Button>
                </form>
              )}
            </>
          ) : (
            /* Standard Secure Sign In Mode */
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-gold/20 text-gold">
                  <LockKeyhole className="h-7 w-7" />
                </div>
                <h2 className="font-display text-3xl font-semibold">Sign In</h2>
                <p className="mt-2 text-sm text-muted">
                  {isSupabaseConfigured
                    ? 'Sign in with your registered email or first name and password.'
                    : 'Supabase keys are not set yet, so you can preview with demo users.'}
                </p>
              </div>

              {initialEmail && (
                <div className="mb-4 rounded-md bg-gold/10 p-2.5 text-xs text-ink flex items-center gap-2 border border-gold/30">
                  <ShieldCheck className="h-4 w-4 text-gold shrink-0" />
                  <span>
                    Signing in as <strong>{initialEmail}</strong>
                  </span>
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <Field
                  label="Email or First Name"
                  type="text"
                  placeholder="e.g., Tahir or tahir@example.com"
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                  autoComplete="username"
                  required
                />
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required={isSupabaseConfigured}
                />

                {error || formError ? (
                  <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{error || formError}</p>
                ) : null}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  <UserRound className="h-4 w-4" />
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>

              <div className="mt-6 border-t border-border pt-4 text-center">
                <p className="text-xs text-muted">
                  🔒 New accounts can only be added by an <strong>Administrator</strong> or{' '}
                  <strong>Project Manager</strong>.
                </p>
              </div>
            </>
          )}

          <div className="mt-6 border-t border-border pt-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                <Sparkles className="h-3.5 w-3.5 text-gold" />
                1-Click Demo Showcase
              </span>
              <span className="rounded bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">
                Presentation Mode
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { role: 'admin' as Role, name: 'Tahir', desc: 'Admin & Finance', icon: Crown },
                { role: 'project_manager' as Role, name: 'Atia', desc: 'Operations & Timeline', icon: Briefcase },
                { role: 'employee' as Role, name: 'Zain', desc: 'Designer / Tasks', icon: Palette },
                { role: 'client' as Role, name: 'Amelia', desc: 'Client Portal', icon: User },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.role}
                    type="button"
                    onClick={() => onDemoLogin(item.role)}
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-white p-2.5 text-left transition hover:border-gold hover:bg-gold/5 hover:shadow-xs group"
                  >
                    <div className="grid h-8 w-8 place-items-center rounded-md bg-linen text-gold group-hover:bg-gold group-hover:text-ink transition-colors">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink flex items-center justify-between">
                        {item.name}
                        <span className="text-[10px] font-normal text-muted">{item.desc}</span>
                      </p>
                      <p className="text-[10px] text-muted truncate">Enter as {roleLabels[item.role]}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
