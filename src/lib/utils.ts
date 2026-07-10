import type { Project, Role } from './types';

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

export function firstName(name: string | null | undefined) {
  const cleanName = (name || '').trim();
  return cleanName ? cleanName.split(/\s+/)[0] : 'User';
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function isManagerRole(role: Role | null | undefined) {
  return role === 'admin' || role === 'manager' || role === 'project_manager';
}

export function isClientRole(role: Role | null | undefined) {
  return role === 'client';
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.') {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
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
