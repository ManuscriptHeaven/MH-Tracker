import type { QuickAction } from './aiTypes';

export function getQuickActions(currentView: string): QuickAction[] {
  const actions: QuickAction[] = [];

  if (currentView.includes('project')) {
    actions.push({
      id: 'qa-proj-1',
      label: 'Overdue Projects',
      command: 'How many projects are overdue?',
      category: 'projects',
      icon: 'clock',
    });
    actions.push({
      id: 'qa-proj-2',
      label: 'Due Today',
      command: "What's due today?",
      category: 'projects',
      icon: 'calendar',
    });
    actions.push({
      id: 'qa-proj-3',
      label: 'In Revision',
      command: 'How many projects are in revision?',
      category: 'projects',
      icon: 'file-text',
    });
  } else if (currentView.includes('task')) {
    actions.push({
      id: 'qa-task-1',
      label: 'My Tasks',
      command: 'What are my tasks?',
      category: 'tasks',
      icon: 'check-square',
    });
    actions.push({
      id: 'qa-task-2',
      label: 'Overdue Tasks',
      command: 'How many tasks are overdue?',
      category: 'tasks',
      icon: 'clock',
    });
  } else if (currentView.includes('finance') || currentView.includes('payment')) {
    actions.push({
      id: 'qa-fin-1',
      label: 'Client Receivables',
      command: 'How much do clients owe us?',
      category: 'finance',
      icon: 'dollar-sign',
    });
    actions.push({
      id: 'qa-fin-2',
      label: 'Monthly Income',
      command: "What's our income this month?",
      category: 'finance',
      icon: 'trending-up',
    });
  } else if (currentView.includes('team')) {
    actions.push({
      id: 'qa-team-1',
      label: 'Team Workload',
      command: 'Which employee has the most active projects?',
      category: 'team',
      icon: 'users',
    });
  } else {
    actions.push({
      id: 'qa-gen-1',
      label: 'Project Summary',
      command: 'How many active projects do we have?',
      category: 'general',
      icon: 'pie-chart',
    });
    actions.push({
      id: 'qa-gen-2',
      label: 'Due Today',
      command: "What's due today?",
      category: 'general',
      icon: 'calendar',
    });
    actions.push({
      id: 'qa-gen-3',
      label: 'Overdue Projects',
      command: 'How many projects are overdue?',
      category: 'general',
      icon: 'clock',
    });
  }

  return actions;
}
