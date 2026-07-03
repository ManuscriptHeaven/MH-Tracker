import { CheckCircle2, Database, KeyRound, ShieldCheck } from 'lucide-react';
import { Card } from '../components/ui';
import { isSupabaseConfigured } from '../lib/supabase';

export function SettingsPage({ mode }: { mode: 'demo' | 'supabase' }) {
  const items = [
    'Create Supabase project',
    'Run supabase/schema.sql',
    'Create admin in Supabase Auth',
    'Add admin profile row',
    'Add employees and roles',
    'Add Cloudflare Pages environment variables',
    'Deploy with npm run build and dist output',
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <h2 className="font-display text-2xl font-semibold">App Mode</h2>
        <div className="mt-5 grid gap-3">
          <div className="flex items-center gap-3 rounded-md border border-border bg-ivory p-4">
            <Database className="h-5 w-5 text-gold" />
            <div>
              <p className="font-semibold">{mode === 'supabase' ? 'Supabase Connected' : 'Demo Mode'}</p>
              <p className="text-sm text-muted">
                {isSupabaseConfigured
                  ? 'The app has Supabase environment variables.'
                  : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect real data.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-ivory p-4">
            <ShieldCheck className="h-5 w-5 text-gold" />
            <div>
              <p className="font-semibold">Role-Based Access</p>
              <p className="text-sm text-muted">Employees see assigned projects. Admin and managers see all projects.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-ivory p-4">
            <KeyRound className="h-5 w-5 text-gold" />
            <div>
              <p className="font-semibold">Auth</p>
              <p className="text-sm text-muted">Name and password login is backed by Supabase Auth.</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-2xl font-semibold">Setup Checklist</h2>
        <div className="mt-5 space-y-3">
          {items.map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-md border border-border bg-white p-3">
              <CheckCircle2 className="h-5 w-5 text-gold" />
              <span className="text-sm font-medium">{item}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
