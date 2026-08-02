import { AICommand, AIActionResult, QuickAction } from './aiTypes';

export function parseCommand(message: string): AICommand | null {
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes('find project') || lowerMsg.includes('search project')) {
    const match = message.match(/(?:find|search) project (.+)/i);
    return {
      type: 'find_project',
      params: { query: match ? match[1].trim() : '' },
      requiresConfirmation: false,
      description: 'Find a specific project'
    };
  }
  
  if (lowerMsg.includes('generate invoice') || lowerMsg.includes('create invoice')) {
    const match = message.match(/(?:generate|create) invoice for (.+)/i);
    return {
      type: 'generate_invoice',
      params: { projectOrClient: match ? match[1].trim() : '' },
      requiresConfirmation: true,
      description: 'Generate a new invoice'
    };
  }
  
  if (lowerMsg.includes('create client')) {
    const match = message.match(/create client (.+)/i);
    return {
      type: 'create_client',
      params: { name: match ? match[1].trim() : '' },
      requiresConfirmation: true,
      description: 'Create a new client profile'
    };
  }
  
  if (lowerMsg.includes('update status')) {
    const match = message.match(/update status of (.+) to (.+)/i);
    return {
      type: 'update_status',
      params: { 
        target: match ? match[1].trim() : '', 
        status: match ? match[2].trim() : '' 
      },
      requiresConfirmation: true,
      description: 'Update status of an item'
    };
  }
  
  if (lowerMsg.includes('search files')) {
    const match = message.match(/search files (.+)/i);
    return {
      type: 'search_files',
      params: { query: match ? match[1].trim() : '' },
      requiresConfirmation: false,
      description: 'Search through uploaded files'
    };
  }
  
  if (lowerMsg.includes('show overdue tasks') || lowerMsg.includes('overdue')) {
    return {
      type: 'show_overdue_tasks',
      params: {},
      requiresConfirmation: false,
      description: 'Show tasks that are past their due date'
    };
  }
  
  if (lowerMsg.includes('draft email to')) {
    const match = message.match(/draft email to (.+)/i);
    return {
      type: 'draft_email',
      params: { recipient: match ? match[1].trim() : '' },
      requiresConfirmation: false,
      description: 'Draft an email message'
    };
  }
  
  if (lowerMsg.includes('calculate quote for')) {
    const match = message.match(/calculate quote for (.+)/i);
    return {
      type: 'calculate_quote',
      params: { projectDetails: match ? match[1].trim() : '' },
      requiresConfirmation: false,
      description: 'Calculate a project quote'
    };
  }
  
  if (lowerMsg.includes('generate report') || lowerMsg.includes('show report')) {
    return {
      type: 'generate_report',
      params: {},
      requiresConfirmation: false,
      description: 'Generate a summary report'
    };
  }
  
  if (lowerMsg.includes('show pending invoices')) {
    return {
      type: 'show_pending_invoices',
      params: {},
      requiresConfirmation: false,
      description: 'Show invoices pending payment'
    };
  }
  
  if (lowerMsg.includes('what is due today') || lowerMsg.includes('due today')) {
    return {
      type: 'show_due_today',
      params: {},
      requiresConfirmation: false,
      description: 'Show items due today'
    };
  }
  
  return null;
}

export async function executeCommand(
  command: AICommand, 
  trackerData: any, 
  trackerActions: any
): Promise<AIActionResult> {
  try {
    switch (command.type) {
      case 'find_project':
        const query = (command.params.query as string).toLowerCase();
        const foundProjects = trackerData.projects?.filter((p: any) => 
          p.title.toLowerCase().includes(query) || p.description?.toLowerCase().includes(query)
        );
        return {
          success: true,
          message: `Found ${foundProjects?.length || 0} projects matching "${query}".`,
          data: foundProjects
        };
        
      case 'show_overdue_tasks':
        const now = new Date();
        const overdueTasks = trackerData.tasks?.filter((t: any) => 
          t.dueDate && new Date(t.dueDate) < now && t.status !== 'completed'
        );
        return {
          success: true,
          message: `You have ${overdueTasks?.length || 0} overdue tasks.`,
          data: overdueTasks
        };
        
      case 'show_due_today':
        const todayStr = new Date().toISOString().split('T')[0];
        const dueToday = trackerData.tasks?.filter((t: any) => 
          t.dueDate && t.dueDate.startsWith(todayStr) && t.status !== 'completed'
        );
        return {
          success: true,
          message: `You have ${dueToday?.length || 0} tasks due today.`,
          data: dueToday
        };

      case 'generate_invoice':
        return {
          success: true,
          message: `Invoice generation initiated for ${command.params.projectOrClient}.`
        };

      case 'create_client':
        return {
          success: true,
          message: `Client ${command.params.name} created.`
        };

      case 'update_status':
        return {
          success: true,
          message: `Status updated for ${command.params.target} to ${command.params.status}.`
        };
        
      default:
        return {
          success: false,
          message: `Command type ${command.type} not fully implemented yet.`
        };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to execute command: ${error.message}`
    };
  }
}

export function getQuickActions(currentView: string, trackerData: any): QuickAction[] {
  const actions: QuickAction[] = [];
  
  if (currentView.includes('project')) {
    actions.push({
      id: 'qa-proj-1',
      label: 'Find Project',
      command: 'Find project ',
      category: 'projects',
      icon: 'search'
    });
    actions.push({
      id: 'qa-proj-2',
      label: 'Generate Invoice',
      command: 'Generate invoice for ',
      category: 'invoices',
      icon: 'file-text'
    });
  } else if (currentView.includes('task')) {
    actions.push({
      id: 'qa-task-1',
      label: 'Show Overdue',
      command: 'Show overdue tasks',
      category: 'tasks',
      icon: 'clock'
    });
    actions.push({
      id: 'qa-task-2',
      label: 'Due Today',
      command: 'What is due today?',
      category: 'tasks',
      icon: 'calendar'
    });
  } else {
    actions.push({
      id: 'qa-gen-1',
      label: 'Daily Summary',
      command: 'Generate report',
      category: 'general',
      icon: 'pie-chart'
    });
    actions.push({
      id: 'qa-gen-2',
      label: 'Search Files',
      command: 'Search files ',
      category: 'general',
      icon: 'folder'
    });
  }
  
  return actions;
}
