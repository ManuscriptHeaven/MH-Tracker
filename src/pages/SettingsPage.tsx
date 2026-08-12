import { CheckCircle2, Clock, Database, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Field } from '../components/ui';
import { DEFAULT_WORKFLOW_SETTINGS } from '../lib/constants';
import { isSupabaseConfigured } from '../lib/supabase';
import type { WorkflowSettings } from '../lib/types';
import { AISettingsSection } from '../components/ai/AISettingsSection';
import { useAIContext } from '../lib/ai/aiContext';

export function SettingsPage({ mode }: { mode: 'demo' | 'supabase' }) {
  const { settings, updateSettings } = useAIContext();
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings>(() => {
    const saved = localStorage.getItem('mh_workflow_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_WORKFLOW_SETTINGS;
      }
    }
    return DEFAULT_WORKFLOW_SETTINGS;
  });
  const [isSaved, setIsSaved] = useState(false);

  function saveWorkflowSettings() {
    localStorage.setItem('mh_workflow_settings', JSON.stringify(workflowSettings));
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  }

  function updateField<K extends keyof WorkflowSettings>(key: K, value: WorkflowSettings[K]) {
    setWorkflowSettings((prev) => ({ ...prev, [key]: value }));
  }

  const items = [
    'Create Supabase project',
    'Run supabase/schema.sql',
    'Run supabase/time-aware-production-timeline.sql',
    'Create admin in Supabase Auth',
    'Add admin profile row',
    'Add employees and roles',
    'Add Cloudflare Pages & Supabase Secrets (GEMINI_API_KEY, GROQ_API_KEY)',
    'Deploy with npm run build and dist output',
  ];

  return (
    <div className="space-y-6">
      {/* Workflow Stage Allocations Settings */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Clock className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl font-semibold">Production Timeline Settings</h2>
        </div>
        <p className="text-sm text-muted mb-6">
          Configure default active production day allocations for each stage. Client approval stages do not consume production time.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Files Received (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.files_received_days}
            onChange={(e) => updateField('files_received_days', Number(e.target.value))}
          />
          <Field
            label="Design Concept (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.design_concept_days}
            onChange={(e) => updateField('design_concept_days', Number(e.target.value))}
          />
          <Field
            label="Concept Revision (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.design_concept_revision_days}
            onChange={(e) => updateField('design_concept_revision_days', Number(e.target.value))}
          />
          <Field
            label="Print Version (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.print_version_days}
            onChange={(e) => updateField('print_version_days', Number(e.target.value))}
          />
          <Field
            label="Print Revision (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.print_version_revision_days}
            onChange={(e) => updateField('print_version_revision_days', Number(e.target.value))}
          />
          <Field
            label="Ebook Version (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.ebook_version_days}
            onChange={(e) => updateField('ebook_version_days', Number(e.target.value))}
          />
          <Field
            label="Ebook Revision (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.ebook_version_revision_days}
            onChange={(e) => updateField('ebook_version_revision_days', Number(e.target.value))}
          />
          <Field
            label="Final Delivery (Days)"
            type="number"
            min={1}
            max={30}
            value={workflowSettings.final_delivery_days}
            onChange={(e) => updateField('final_delivery_days', Number(e.target.value))}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={workflowSettings.exclude_weekends ?? true}
              onChange={(e) => updateField('exclude_weekends', e.target.checked)}
              className="h-4 w-4 rounded border-border text-gold focus:ring-gold"
            />
            <span>Exclude Weekends from Production Time (Working Days Calculation)</span>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button type="button" onClick={saveWorkflowSettings}>
            Save Workflow Settings
          </Button>
          {isSaved ? <span className="text-xs font-semibold text-success">Settings saved!</span> : null}
        </div>
      </Card>

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

      <AISettingsSection settings={settings} onUpdate={updateSettings} />
    </div>
  );
}
