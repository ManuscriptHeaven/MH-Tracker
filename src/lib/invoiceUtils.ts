import type { Invoice, InvoiceItem, Project } from './types';

export const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function calculateDueAmount(project: Project): number {
  const total = Number(project.total_price || 0);
  const paid = Number(project.advance_paid || 0);
  return Math.max(total - paid, 0);
}

export function isProjectCompleted(project: Project): boolean {
  const status = (project.status || '').toLowerCase();
  return (
    status === 'completed' ||
    status === 'delivered' ||
    status === 'ready for delivery' ||
    status === 'final qa'
  );
}

export function getProjectDateString(project: Project): string {
  return project.delivery_date || project.due_date || project.start_date || project.created_at || '';
}

export function getProjectMonth(project: Project): number {
  const dateStr = getProjectDateString(project);
  return dateStr ? Number(dateStr.slice(5, 7)) : 0;
}

export function getProjectYear(project: Project): number {
  const dateStr = getProjectDateString(project);
  return dateStr ? Number(dateStr.slice(0, 4)) : 0;
}

export function getEligibleProjectsForClient(
  projects: Project[],
  clientName: string,
  month: number | 'all',
  year: number | 'all',
  paymentStatus: string = 'all',
): Project[] {
  if (!clientName || clientName === 'all') {
    return [];
  }

  return projects.filter((project) => {
    // Must belong to client
    if (project.client_name !== clientName) {
      return false;
    }

    // Must be completed
    if (!isProjectCompleted(project)) {
      return false;
    }

    // Must not already be invoiced
    if (project.invoiced || project.invoice_id) {
      return false;
    }

    // Filter by month/year if specified
    if (month !== 'all' && getProjectMonth(project) !== Number(month)) {
      return false;
    }

    if (year !== 'all' && getProjectYear(project) !== Number(year)) {
      return false;
    }

    // Filter by Payment Status if specified
    if (paymentStatus && paymentStatus !== 'all') {
      const due = calculateDueAmount(project);
      const paid = Number(project.advance_paid || 0);
      const total = Number(project.total_price || 0);
      const pStatus = (project.payment_status || '').toLowerCase();
      const target = paymentStatus.toLowerCase();

      if (target === 'paid' || target === 'fully paid') {
        if (due > 0 || (total > 0 && paid < total && pStatus !== 'fully paid')) {
          return false;
        }
      } else if (target === 'unpaid') {
        if (paid > 0 || due <= 0) {
          return false;
        }
      } else if (target === 'partial' || target === 'partially paid') {
        if (paid <= 0 || due <= 0) {
          return false;
        }
      } else if (pStatus !== target && project.payment_status !== paymentStatus) {
        return false;
      }
    }

    return true;
  });
}

export function generateInvoiceNumber(clientName: string, year: number, month: number): string {
  const yearStr = year > 0 ? String(year) : String(new Date().getFullYear());
  const monthStr = month > 0 ? String(month).padStart(2, '0') : String(new Date().getMonth() + 1).padStart(2, '0');
  const clientSlug = (clientName || 'CLI')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 5);
  const randomSuffix = Math.floor(100 + Math.random() * 900);

  return `INV-${yearStr}${monthStr}-${clientSlug}-${randomSuffix}`;
}

export function createBulkInvoice(
  clientName: string,
  clientEmail: string,
  eligibleProjects: Project[],
  month: number | 'all',
  year: number | 'all',
): Invoice {
  const currentYear = year !== 'all' && Number(year) > 0 ? Number(year) : new Date().getFullYear();
  const currentMonth = month !== 'all' && Number(month) > 0 ? Number(month) : new Date().getMonth() + 1;
  const monthLabelText = `${monthNames[currentMonth - 1] || 'Current'} ${currentYear}`;
  const invoiceNum = generateInvoiceNumber(clientName, currentYear, currentMonth);

  const items: InvoiceItem[] = eligibleProjects.map((project) => {
    const total = Number(project.total_price || 0);
    const paid = Number(project.advance_paid || 0);
    const due = calculateDueAmount(project);

    return {
      project_id: project.id,
      project_number: project.project_number,
      project_title: project.project_title,
      service_type: project.service_type || 'Publishing Service',
      total_price: total,
      advance_paid: paid,
      due_amount: due,
      completion_date: project.delivery_date || project.due_date,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.total_price, 0);
  const total_paid = items.reduce((sum, item) => sum + item.advance_paid, 0);
  const total_due = Math.max(subtotal - total_paid, 0);

  // Set due date to 15 days from today or end of month
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  return {
    id: `inv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    invoice_number: invoiceNum,
    client_name: clientName,
    client_email: clientEmail || eligibleProjects[0]?.client_email || '',
    month: currentMonth,
    year: currentYear,
    month_label: monthLabelText,
    created_at: new Date().toISOString(),
    due_date: dueDateStr,
    items,
    subtotal,
    total_paid,
    total_due,
    status: total_due === 0 ? 'Paid' : 'Sent',
  };
}

/**
 * Future Enhancement Helper:
 * Group all eligible projects by client for batch monthly invoice generation.
 */
export function getAllClientsWithEligibleProjects(
  projects: Project[],
  month: number | 'all',
  year: number | 'all',
): Map<string, { clientName: string; clientEmail: string; projects: Project[] }> {
  const grouped = new Map<string, { clientName: string; clientEmail: string; projects: Project[] }>();

  projects.forEach((project) => {
    if (!isProjectCompleted(project) || project.invoiced || project.invoice_id) {
      return;
    }

    if (month !== 'all' && getProjectMonth(project) !== Number(month)) {
      return;
    }

    if (year !== 'all' && getProjectYear(project) !== Number(year)) {
      return;
    }

    const clientName = project.client_name;
    if (!clientName) {
      return;
    }

    const existing = grouped.get(clientName) || {
      clientName,
      clientEmail: project.client_email || '',
      projects: [],
    };

    existing.projects.push(project);
    grouped.set(clientName, existing);
  });

  return grouped;
}
