import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Landmark, Plus, Trash2, WalletCards } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile, Project } from '../lib/types';
import { Button, Card, EmptyState, Field, Modal, SelectField } from '../components/ui';
import { errorMessage } from '../lib/utils';

type TransactionType = 'income' | 'expense';
type FinanceTransaction = { id: string; type: TransactionType; category: string; description: string; amount: number; transaction_date: string; project_id: string | null; created_at: string };
type TransactionDraft = Omit<FinanceTransaction, 'id' | 'created_at'>;

const demoTransactions: FinanceTransaction[] = [
  { id: 'demo-income', type: 'income', category: 'Project payment', description: 'Website project advance', amount: 55000, transaction_date: '2026-08-01', project_id: null, created_at: '2026-08-01T00:00:00Z' },
  { id: 'demo-expense', type: 'expense', category: 'Operations', description: 'Software subscriptions', amount: 8500, transaction_date: '2026-08-01', project_id: null, created_at: '2026-08-01T00:00:00Z' },
];

const money = (amount: number) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(amount || 0);

export function FinancePage({ currentProfile, projects }: { currentProfile: Profile; projects: Project[] }) {
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function loadTransactions() {
    if (!supabase) {
      const saved = localStorage.getItem('mh-finance-demo');
      setTransactions(saved ? JSON.parse(saved) as FinanceTransaction[] : demoTransactions);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: loadError } = await supabase.from('finance_transactions').select('*').order('transaction_date', { ascending: false }).order('created_at', { ascending: false });
    if (loadError) setError(errorMessage(loadError, 'Finance data could not be loaded.'));
    else setTransactions((data || []) as FinanceTransaction[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadTransactions();
    if (!supabase) return;
    const client = supabase;
    const channel = client.channel('finance-transactions').on('postgres_changes', { event: '*', schema: 'public', table: 'finance_transactions' }, () => { void loadTransactions(); }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, []);

  const totals = useMemo(() => {
    const income = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
    const expenses = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
    return { income, expenses, balance: income - expenses };
  }, [transactions]);
  const projectName = (id: string | null) => projects.find((project) => project.id === id)?.project_title || 'General';

  async function saveTransaction(draft: TransactionDraft) {
    if (!supabase) {
      const next = [{ ...draft, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...transactions];
      setTransactions(next); localStorage.setItem('mh-finance-demo', JSON.stringify(next)); setShowForm(false); return;
    }
    const { error: insertError } = await supabase.from('finance_transactions').insert({ ...draft, created_by: currentProfile.id });
    if (insertError) { setError(errorMessage(insertError, 'Transaction could not be saved.')); return; }
    setShowForm(false); await loadTransactions();
  }

  async function deleteTransaction(id: string) {
    if (!window.confirm('Delete this finance entry?')) return;
    if (!supabase) { const next = transactions.filter((item) => item.id !== id); setTransactions(next); localStorage.setItem('mh-finance-demo', JSON.stringify(next)); return; }
    const { error: deleteError } = await supabase.from('finance_transactions').delete().eq('id', id);
    if (deleteError) { setError(errorMessage(deleteError, 'Transaction could not be deleted.')); return; }
    await loadTransactions();
  }

  return <div className="space-y-6">
    {!supabase && <div className="rounded-md border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-ink">Demo mode: add Supabase credentials and run <code>supabase/finance-tracker.sql</code> to save shared live finance data.</div>}
    {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">{error}</div>}
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-sm text-muted">Admin-only financial overview</p><h2 className="font-display text-3xl font-semibold text-ink">Finance tracker</h2></div><Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Add transaction</Button></div>
    <div className="grid gap-4 md:grid-cols-3">
      <SummaryCard label="Available balance" value={money(totals.balance)} icon={<WalletCards className="h-5 w-5" />} tone="text-ink" />
      <SummaryCard label="Total income" value={money(totals.income)} icon={<ArrowDownRight className="h-5 w-5" />} tone="text-success" />
      <SummaryCard label="Total expenses" value={money(totals.expenses)} icon={<ArrowUpRight className="h-5 w-5" />} tone="text-danger" />
    </div>
    <Card className="overflow-hidden p-0"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-display text-xl font-semibold">Transactions</h3><p className="mt-1 text-sm text-muted">Income and expenses linked to your projects.</p></div><Landmark className="h-5 w-5 text-gold" /></div>{loading ? <p className="p-6 text-sm text-muted">Loading live finance data…</p> : transactions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-ivory text-xs uppercase tracking-wide text-muted"><tr><th className="px-5 py-3">Entry</th><th className="px-5 py-3">Project</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3" /></tr></thead><tbody>{transactions.map((item) => <tr className="border-t border-border/70" key={item.id}><td className="px-5 py-4"><p className="font-semibold text-ink">{item.description}</p><p className="mt-1 text-xs text-muted">{item.category} · <span className={item.type === 'income' ? 'text-success' : 'text-danger'}>{item.type}</span></p></td><td className="px-5 py-4 text-muted">{projectName(item.project_id)}</td><td className="px-5 py-4 text-muted">{new Date(`${item.transaction_date}T12:00:00`).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td className={`px-5 py-4 font-semibold ${item.type === 'income' ? 'text-success' : 'text-danger'}`}>{item.type === 'income' ? '+' : '-'}{money(item.amount)}</td><td className="px-5 py-4"><button className="rounded p-2 text-muted hover:bg-red-50 hover:text-danger" onClick={() => void deleteTransaction(item.id)} title="Delete entry"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div> : <EmptyState title="No finance entries yet" message="Add your first income or expense to start tracking business finances." action={<Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Add transaction</Button>} />}</Card>
    {showForm && <TransactionForm projects={projects} onClose={() => setShowForm(false)} onSave={saveTransaction} />}
  </div>;
}

function SummaryCard({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: string }) { return <Card><div className="flex items-start justify-between"><div><p className="text-sm text-muted">{label}</p><p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p></div><span className="rounded-md bg-gold/15 p-2 text-gold">{icon}</span></div></Card>; }

function TransactionForm({ projects, onClose, onSave }: { projects: Project[]; onClose: () => void; onSave: (draft: TransactionDraft) => Promise<void> }) {
  const [type, setType] = useState<TransactionType>('expense'); const [description, setDescription] = useState(''); const [amount, setAmount] = useState(''); const [category, setCategory] = useState('Operations'); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [projectId, setProjectId] = useState(''); const [saving, setSaving] = useState(false);
  const categoryOptions = type === 'income' ? ['Project payment', 'Service income', 'Other income'] : ['Operations', 'Team cost', 'Software', 'Marketing', 'Other expense'];
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!description.trim() || Number(amount) <= 0) return; setSaving(true); await onSave({ type, description: description.trim(), amount: Number(amount), category, transaction_date: date, project_id: projectId || null }); setSaving(false); }
  return <Modal title="Add finance transaction" width="max-w-xl" onClose={onClose}><form className="grid gap-4" onSubmit={(event) => void submit(event)}><div className="grid grid-cols-2 gap-3"><Button type="button" variant={type === 'expense' ? 'primary' : 'secondary'} onClick={() => { setType('expense'); setCategory('Operations'); }}>Expense</Button><Button type="button" variant={type === 'income' ? 'primary' : 'secondary'} onClick={() => { setType('income'); setCategory('Project payment'); }}>Income</Button></div><Field label="Description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. Client advance payment" required /><div className="grid gap-4 sm:grid-cols-2"><Field label="Amount (PKR)" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} required /><SelectField label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>{categoryOptions.map((item) => <option key={item}>{item}</option>)}</SelectField></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /><SelectField label="Related project (optional)" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">General business entry</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_number} — {project.project_title}</option>)}</SelectField></div><div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save transaction'}</Button></div></form></Modal>;
}
