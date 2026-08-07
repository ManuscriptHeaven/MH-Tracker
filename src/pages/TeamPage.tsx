import { useMemo, useState } from 'react';
import { DollarSign, Mail, Phone, TrendingUp, Users } from 'lucide-react';
import { RoleBadge } from '../components/Badges';
import { Button, Card } from '../components/ui';
import { closedStatuses } from '../lib/constants';
import { isOverdue } from '../lib/date';
import { currency, firstName, initials, isClientRole } from '../lib/utils';
import type { EmployeeCompensation, EmployeeLedgerEntry, Profile, Project, Task } from '../lib/types';

type Tab = 'overview' | 'employees' | 'payroll' | 'workload';

function employeeMetrics(profile: Profile, projects: Project[], tasks: Task[]) {
  const assigned = projects.filter((project) => project.assigned_to === profile.id);
  const active = assigned.filter((project) => !closedStatuses.includes(project.status));
  const completed = assigned.filter((project) => closedStatuses.includes(project.status));
  const overdue = active.filter(isOverdue);
  const employeeTasks = tasks.filter((task) => task.assigned_to === profile.id);
  const doneTasks = employeeTasks.filter((task) => task.status === 'Done');
  const quality = assigned.length ? Math.round(((assigned.length - overdue.length) / assigned.length) * 100) : 100;
  const performance = Math.max(0, Math.round(quality * 0.55 + (employeeTasks.length ? (doneTasks.length / employeeTasks.length) * 45 : 45)));
  return { assigned, active, completed, overdue, employeeTasks, doneTasks, quality, performance };
}

function ledgerSummary(employeeId: string, compensation: EmployeeCompensation | undefined, ledger: EmployeeLedgerEntry[]) {
  const entries = ledger.filter((entry) => entry.employee_id === employeeId);
  const amount = (type: EmployeeLedgerEntry['entry_type']) => entries.filter((entry) => entry.entry_type === type).reduce((sum, entry) => sum + Number(entry.amount), 0);
  const payable = Number(compensation?.monthly_salary || 0) + amount('Salary') + amount('Project Payment') + amount('Advance') - amount('Deduction');
  const paid = amount('Payment');
  return { payable, paid, due: Math.max(0, payable - paid) };
}

export function TeamPage({ profiles, projects, tasks, compensation, ledger, canManagePayroll }: {
  profiles: Profile[]; projects: Project[]; tasks: Task[]; compensation: EmployeeCompensation[]; ledger: EmployeeLedgerEntry[]; canManagePayroll: boolean;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const team = profiles.filter((profile) => !isClientRole(profile.role));
  const rows = useMemo(() => team.map((profile) => ({ profile, metrics: employeeMetrics(profile, projects, tasks), compensation: compensation.find((item) => item.employee_id === profile.id) })), [team, projects, tasks, compensation]);
  const totalPayroll = rows.reduce((sum, row) => sum + ledgerSummary(row.profile.id, row.compensation, ledger).payable, 0);
  const totalDue = rows.reduce((sum, row) => sum + ledgerSummary(row.profile.id, row.compensation, ledger).due, 0);
  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'overview', label: 'Team Overview' }, { id: 'employees', label: 'Employees' }, { id: 'workload', label: 'Workload' }, ...(canManagePayroll ? [{ id: 'payroll' as Tab, label: 'Payroll & Dues' }] : [])];

  return <div className="space-y-6">
    <div className="flex flex-wrap gap-2">{tabs.map((item) => <Button key={item.id} type="button" variant={tab === item.id ? 'primary' : 'secondary'} onClick={() => setTab(item.id)}>{item.label}</Button>)}</div>
    {tab === 'overview' ? <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Total Employees" value={team.length} icon={Users} /><Stat label="Active Employees" value={team.filter((p) => p.status !== 'inactive').length} icon={Users} />
        <Stat label="Projects Assigned" value={rows.reduce((sum, row) => sum + row.metrics.active.length, 0)} icon={TrendingUp} /><Stat label="Monthly Payroll" value={currency(totalPayroll)} icon={DollarSign} /><Stat label="Outstanding Dues" value={currency(totalDue)} icon={DollarSign} />
      </section>
      <PerformanceTable rows={rows} />
    </> : null}
    {tab === 'employees' ? <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{rows.map(({ profile, metrics, compensation: pay }) => <Card key={profile.id}><div className="flex items-start gap-4"><div className="grid h-14 w-14 place-items-center rounded-lg bg-gold/20 text-lg font-bold">{initials(firstName(profile.full_name))}</div><div className="min-w-0"><h3 className="font-display text-xl font-semibold">{profile.full_name}</h3><RoleBadge role={profile.role} /></div></div><div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm"><Metric label="Active" value={metrics.active.length}/><Metric label="Completed" value={metrics.completed.length}/><Metric label="Performance" value={`${metrics.performance}%`}/></div><div className="mt-5 space-y-2 text-sm text-muted"><p className="flex gap-2"><Mail className="h-4 w-4"/>{profile.email}</p>{profile.phone ? <p className="flex gap-2"><Phone className="h-4 w-4"/>{profile.phone}</p> : null}<p>Monthly: <strong className="text-ink">{currency(pay?.monthly_salary || 0)}</strong> · Per Project: <strong className="text-ink">{currency(pay?.per_project_rate || 0)}</strong></p><p>Responsibilities: {pay?.responsibilities || 'Not set'}</p></div></Card>)}</section> : null}
    {tab === 'workload' ? <section className="space-y-4">{rows.map(({ profile, metrics }) => <Card key={profile.id}><div className="flex items-center justify-between"><div><h3 className="font-semibold">{profile.full_name}</h3><p className="text-sm text-muted">{metrics.active.length} active projects · {metrics.doneTasks.length}/{metrics.employeeTasks.length} tasks complete</p></div><span className="font-bold text-danger">{metrics.overdue.length} overdue</span></div><div className="mt-4 grid gap-2 md:grid-cols-3">{metrics.active.map((project) => <div key={project.id} className="rounded-md bg-ivory p-3 text-sm"><strong>{project.project_title}</strong><p className="text-muted">{project.current_stage || project.status} · Due {project.due_date}</p></div>) || <p className="text-sm text-muted">No active projects.</p>}</div></Card>)}</section> : null}
    {tab === 'payroll' && canManagePayroll ? <Card><h2 className="font-display text-2xl font-semibold">Payroll & Dues</h2><p className="mt-1 text-sm text-muted">Fixed monthly salary, project earnings, advances, deductions, and payments are tracked in the employee ledger.</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-muted"><tr><th className="pb-3">Employee</th><th>Monthly</th><th>Payable</th><th>Paid</th><th>Outstanding</th></tr></thead><tbody>{rows.map(({ profile, compensation: pay }) => { const summary = ledgerSummary(profile.id, pay, ledger); return <tr key={profile.id} className="border-t border-border"><td className="py-3 font-semibold">{profile.full_name}</td><td>{currency(pay?.monthly_salary || 0)}</td><td>{currency(summary.payable)}</td><td>{currency(summary.paid)}</td><td className="font-bold text-danger">{currency(summary.due)}</td></tr>; })}</tbody></table></div></Card> : null}
  </div>;
}
function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Users }) { return <Card><Icon className="h-5 w-5 text-gold"/><p className="mt-3 text-2xl font-bold">{value}</p><p className="text-sm text-muted">{label}</p></Card>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-md bg-ivory p-2"><p className="font-bold">{value}</p><p className="text-xs text-muted">{label}</p></div>; }
function PerformanceTable({ rows }: { rows: Array<{ profile: Profile; metrics: ReturnType<typeof employeeMetrics> }> }) { return <Card><h2 className="font-display text-2xl font-semibold">Employee Performance</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-muted"><tr><th className="pb-3">Employee</th><th>Projects</th><th>Completed</th><th>Overdue</th><th>Quality</th><th>Performance</th></tr></thead><tbody>{rows.map(({ profile, metrics }) => <tr key={profile.id} className="border-t border-border"><td className="py-3 font-semibold">{profile.full_name}</td><td>{metrics.assigned.length}</td><td>{metrics.completed.length}</td><td className="text-danger">{metrics.overdue.length}</td><td>{metrics.quality}%</td><td><span className="font-bold">{metrics.performance}%</span><div className="mt-1 h-1.5 w-24 rounded bg-ivory"><div className="h-full rounded bg-gold" style={{ width: `${metrics.performance}%` }}/></div></td></tr>)}</tbody></table></div></Card>; }
