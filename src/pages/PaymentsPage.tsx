import { CircleDollarSign } from 'lucide-react';
import { PaymentBadge } from '../components/Badges';
import { Card } from '../components/ui';
import { currency } from '../lib/utils';
import type { Project } from '../lib/types';

export function PaymentsPage({
  projects,
  onSelectProject,
}: {
  projects: Project[];
  onSelectProject: (project: Project) => void;
}) {
  const totalRevenue = projects.reduce((sum, project) => sum + Number(project.total_price || 0), 0);
  const collected = projects.reduce((sum, project) => sum + Number(project.advance_paid || 0), 0);
  const pending = projects.reduce((sum, project) => sum + Number(project.remaining_balance || 0), 0);
  const unpaidProjects = projects.filter((project) => project.remaining_balance > 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Total Project Value</p>
          <p className="mt-3 text-3xl font-bold">{currency(totalRevenue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Collected</p>
          <p className="mt-3 text-3xl font-bold text-success">{currency(collected)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Pending Balance</p>
          <p className="mt-3 text-3xl font-bold text-warning">{currency(pending)}</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-gold/20 text-gold">
            <CircleDollarSign className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold">Pending Payments</h2>
            <p className="text-sm text-muted">Projects with remaining balance.</p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-muted">
              <tr>
                <th className="border-b border-border pb-3">Project</th>
                <th className="border-b border-border pb-3">Client</th>
                <th className="border-b border-border pb-3">Total</th>
                <th className="border-b border-border pb-3">Paid</th>
                <th className="border-b border-border pb-3">Remaining</th>
                <th className="border-b border-border pb-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {unpaidProjects.map((project) => (
                <tr
                  key={project.id}
                  className="cursor-pointer transition hover:bg-ivory"
                  onClick={() => onSelectProject(project)}
                >
                  <td className="border-b border-border/70 py-3">
                    <p className="font-semibold">{project.project_title}</p>
                    <p className="text-xs text-muted">{project.project_number}</p>
                  </td>
                  <td className="border-b border-border/70 py-3">{project.client_name}</td>
                  <td className="border-b border-border/70 py-3">{currency(project.total_price)}</td>
                  <td className="border-b border-border/70 py-3">{currency(project.advance_paid)}</td>
                  <td className="border-b border-border/70 py-3 font-semibold text-warning">
                    {currency(project.remaining_balance)}
                  </td>
                  <td className="border-b border-border/70 py-3">
                    <PaymentBadge status={project.payment_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
