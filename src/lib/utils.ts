import type { Project } from './types';

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function currency(value: number) {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function projectCsv(projects: Project[]) {
  const headers = [
    'Project Number',
    'Title',
    'Client',
    'Status',
    'Priority',
    'Due Date',
    'Payment Status',
    'Remaining Balance',
  ];

  const rows = projects.map((project) => [
    project.project_number,
    project.project_title,
    project.client_name,
    project.status,
    project.priority,
    project.due_date,
    project.payment_status,
    String(project.remaining_balance),
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function downloadTextFile(filename: string, contents: string, mimeType = 'text/plain') {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
