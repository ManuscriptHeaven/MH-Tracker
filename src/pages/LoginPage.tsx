import { BookOpen, CheckCircle2, LockKeyhole, UserPlus, UserRound, Users, Briefcase } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button, Card, Field, SelectField } from '../components/ui';
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
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [loginName, setLoginName] = useState(isSupabaseConfigured ? '' : 'Tahir');
  const [password, setPassword] = useState('');

  // Sign Up form state
  const [signUpFullName, setSignUpFullName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState('');
  const [accountType, setAccountType] = useState<'employee' | 'client'>('employee');
  const [employeeRole, setEmployeeRole] = useState<Role>('employee');
  const [signUpSuccessMsg, setSignUpSuccessMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      await onLogin(loginName, password);
    } catch {
      // Error handles in hook
    }
  }

  async function handleSignUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSignUpSuccessMsg(null);

    if (!signUpFullName.trim()) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!signUpEmail.trim() || !signUpEmail.includes('@')) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (signUpPassword.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }
    if (signUpPassword !== signUpConfirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    const roleToAssign: Role = accountType === 'client' ? 'client' : employeeRole;

    try {
      if (!onSignUp) {
        throw new Error('Sign up service is unavailable.');
      }
      const result = await onSignUp({
        fullName: signUpFullName,
        email: signUpEmail,
        password: signUpPassword,
        role: roleToAssign,
      });

      if (result.requiresConfirmation) {
        setSignUpSuccessMsg('Account created successfully! Please check your email to verify your account.');
      } else {
        setSignUpSuccessMsg('Account created! Logging you in...');
      }
    } catch (err: any) {
      setFormError(err.message || 'Sign up failed. Please try again.');
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
            A complete internal tracker & portal for assigning book projects, tracking deadlines, and managing team & client workflows seamless in Supabase.
          </p>
        </div>

        <p className="text-sm text-white/50">Free-hosting friendly: React, Vite, Supabase, and Cloudflare Pages.</p>
      </section>

      <section className="grid place-items-center py-8">
        <Card className="w-full max-w-md">
          {/* Tab Switcher */}
          <div className="mb-6 flex border-b border-border">
            <button
              type="button"
              onClick={() => {
                setTab('signin');
                setFormError(null);
                setSignUpSuccessMsg(null);
              }}
              className={`flex-1 pb-3 text-center text-sm font-semibold transition border-b-2 ${
                tab === 'signin'
                  ? 'border-gold text-ink font-bold'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('signup');
                setFormError(null);
                setSignUpSuccessMsg(null);
              }}
              className={`flex-1 pb-3 text-center text-sm font-semibold transition border-b-2 ${
                tab === 'signup'
                  ? 'border-gold text-ink font-bold'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              New User Sign Up
            </button>
          </div>

          {tab === 'signin' ? (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-gold/20 text-gold">
                  <LockKeyhole className="h-7 w-7" />
                </div>
                <h2 className="font-display text-3xl font-semibold">Sign In</h2>
                <p className="mt-2 text-sm text-muted">
                  {isSupabaseConfigured
                    ? 'Enter your registered email or first name and password.'
                    : 'Supabase keys are not set yet, so you can preview with demo users.'}
                </p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <Field
                  label="Name or Email"
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
            </>
          ) : (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-gold/20 text-gold">
                  <UserPlus className="h-7 w-7" />
                </div>
                <h2 className="font-display text-3xl font-semibold">Create Account</h2>
                <p className="mt-2 text-sm text-muted">
                  Register a new account in Supabase for Employees or Clients.
                </p>
              </div>

              {/* Account Type Selection */}
              <div className="mb-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
                  Account Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAccountType('employee')}
                    className={`flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold transition ${
                      accountType === 'employee'
                        ? 'border-gold bg-gold/10 text-ink'
                        : 'border-border bg-white text-muted hover:border-gray-400'
                    }`}
                  >
                    <Users className="h-4 w-4 text-gold" />
                    Employee / Staff
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountType('client')}
                    className={`flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold transition ${
                      accountType === 'client'
                        ? 'border-gold bg-gold/10 text-ink'
                        : 'border-border bg-white text-muted hover:border-gray-400'
                    }`}
                  >
                    <Briefcase className="h-4 w-4 text-gold" />
                    Client / Author
                  </button>
                </div>
              </div>

              <form onSubmit={handleSignUpSubmit} className="space-y-4">
                <Field
                  label="Full Name"
                  type="text"
                  placeholder="e.g., Ali Khan"
                  value={signUpFullName}
                  onChange={(event) => setSignUpFullName(event.target.value)}
                  required
                />
                <Field
                  label="Email Address"
                  type="email"
                  placeholder="e.g., ali@example.com"
                  value={signUpEmail}
                  onChange={(event) => setSignUpEmail(event.target.value)}
                  required
                />

                {accountType === 'employee' && (
                  <SelectField
                    label="Employee Role"
                    value={employeeRole}
                    onChange={(e) => setEmployeeRole(e.target.value as Role)}
                  >
                    <option value="employee">Employee / Team Member</option>
                    <option value="project_manager">Project Manager</option>
                    <option value="junior_assistant">Junior Assistant</option>
                  </SelectField>
                )}

                <Field
                  label="Password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={signUpPassword}
                  onChange={(event) => setSignUpPassword(event.target.value)}
                  required
                />
                <Field
                  label="Confirm Password"
                  type="password"
                  placeholder="Re-enter password"
                  value={signUpConfirmPassword}
                  onChange={(event) => setSignUpConfirmPassword(event.target.value)}
                  required
                />

                {signUpSuccessMsg && (
                  <div className="flex items-start gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 border border-emerald-200">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
                    <span>{signUpSuccessMsg}</span>
                  </div>
                )}

                {formError ? (
                  <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{formError}</p>
                ) : null}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  <UserPlus className="h-4 w-4" />
                  {isLoading
                    ? 'Creating Account...'
                    : accountType === 'employee'
                    ? 'Create Employee Account'
                    : 'Create Client Account'}
                </Button>
              </form>
            </>
          )}

          {!isSupabaseConfigured ? (
            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-3 text-sm font-semibold text-muted">Preview Demo Users</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['admin', 'project_manager', 'employee', 'junior_assistant', 'client'] as Role[]).map((role) => (
                  <button
                    key={role}
                    type="button"
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
