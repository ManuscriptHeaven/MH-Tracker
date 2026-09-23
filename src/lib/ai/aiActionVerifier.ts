import type { AIActionPreview, AIActionVerification, AIToolResult } from './aiTypes';

function sameDate(actual: unknown, expected: unknown): boolean {
  if (!actual || !expected) return actual === expected;
  return String(actual).slice(0, 10) === String(expected).slice(0, 10);
}

export async function verifyActionOutcome(
  action: AIActionPreview,
  result: AIToolResult,
): Promise<AIActionVerification | null> {
  if (!result.success) return null;

  try {
    const { isSupabaseConfigured, supabase } = await import('../supabase');
    if (!isSupabaseConfigured || !supabase) {
      return {
        status: 'unverified',
        message: 'Action completed, but live database verification is unavailable in this session.',
      };
    }

    if (action.toolName === 'create_task') {
      const taskId = (result.data as any)?.id;
      if (!taskId) return null;
      const { data, error } = await supabase.from('tasks').select('id,title,status').eq('id', taskId).maybeSingle();
      if (error) throw error;
      return data
        ? { status: 'verified', message: `Verified in Tracker: task "${data.title}" exists with status ${data.status}.` }
        : { status: 'failed', message: 'The task mutation returned success, but the new task could not be found in Tracker.' };
    }

    if (action.toolName === 'create_project' || action.toolName === 'duplicate_project') {
      const projectId = (result.data as any)?.id;
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('projects')
        .select('id,project_title,project_number,project_status,workflow_stage_key')
        .eq('id', projectId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            status: 'verified',
            message: `Verified in Tracker: ${data.project_title} (${data.project_number}) exists at ${data.workflow_stage_key || data.project_status}.`,
          }
        : { status: 'failed', message: 'The project mutation returned success, but the project could not be found in Tracker.' };
    }

    if (action.toolName === 'update_task_status') {
      const { data, error } = await supabase.from('tasks').select('id,title,status').eq('id', action.payload.taskId).maybeSingle();
      if (error) throw error;
      const expected = String(action.payload.status || '');
      return data && String(data.status) === expected
        ? { status: 'verified', message: `Verified in Tracker: "${data.title}" is now ${data.status}.` }
        : {
            status: 'failed',
            message: `Tracker verification did not confirm the requested task status ${expected}.`,
            details: { actual: data?.status, expected },
          };
    }

    if (action.toolName === 'update_task_due_date') {
      const { data, error } = await supabase.from('tasks').select('id,title,due_date').eq('id', action.payload.taskId).maybeSingle();
      if (error) throw error;
      return data && sameDate(data.due_date, action.payload.dueDate)
        ? { status: 'verified', message: `Verified in Tracker: "${data.title}" due date is ${String(data.due_date).slice(0, 10)}.` }
        : {
            status: 'failed',
            message: 'Tracker verification did not confirm the requested task deadline.',
            details: { actual: data?.due_date, expected: action.payload.dueDate },
          };
    }

    if (action.toolName === 'update_project_due_date') {
      const { data, error } = await supabase
        .from('projects')
        .select('id,project_title,due_date')
        .eq('id', action.payload.projectId)
        .maybeSingle();
      if (error) throw error;
      return data && sameDate(data.due_date, action.payload.dueDate)
        ? { status: 'verified', message: `Verified in Tracker: ${data.project_title} deadline is ${String(data.due_date).slice(0, 10)}.` }
        : {
            status: 'failed',
            message: 'Tracker verification did not confirm the requested project deadline.',
            details: { actual: data?.due_date, expected: action.payload.dueDate },
          };
    }

    if (action.toolName === 'update_project_status') {
      const { data, error } = await supabase
        .from('projects')
        .select('id,project_title,status,project_status,workflow_stage_key')
        .eq('id', action.payload.projectId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { status: 'failed', message: 'Project could not be found after the lifecycle mutation.' };

      const requested = String(action.payload.status || '').toLowerCase();
      const expectedLifecycle =
        requested.includes('hold') || requested.includes('pause')
          ? 'on_hold'
          : requested.includes('complete') || requested.includes('deliver')
            ? 'completed'
            : 'active';
      const actualLifecycle = String(data.project_status || '').toLowerCase();

      return actualLifecycle === expectedLifecycle ||
        (expectedLifecycle === 'completed' && String(data.status || '').toLowerCase().includes('complete'))
        ? {
            status: 'verified',
            message: `Verified in Tracker: ${data.project_title} lifecycle is ${data.project_status || data.status}.`,
          }
        : {
            status: 'failed',
            message: 'Tracker verification did not confirm the requested project lifecycle state.',
            details: { actual: data.project_status || data.status, expected: expectedLifecycle },
          };
    }

    if (action.toolName === 'submit_stage_for_approval') {
      const { data, error } = await supabase
        .from('projects')
        .select('id,project_title,project_status,workflow_stage_key,workflow_stage_status_key,workflow_waiting_on_key')
        .eq('id', action.payload.projectId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { status: 'failed', message: 'Project could not be found after stage submission.' };

      const finalDelivery =
        String(data.project_status || '').toLowerCase() === 'completed' ||
        String(data.workflow_stage_key || '').toLowerCase() === 'completed';
      const waitingOnClient =
        String(data.workflow_waiting_on_key || '').toLowerCase() === 'client' ||
        String(data.workflow_stage_key || '').toLowerCase().includes('approval') ||
        String(data.workflow_stage_status_key || '').toLowerCase().includes('await');

      return finalDelivery || waitingOnClient
        ? {
            status: 'verified',
            message: `Verified in Tracker: ${data.project_title} is now ${data.workflow_stage_key || data.project_status} and waiting on ${data.workflow_waiting_on_key || 'the next workflow step'}.`,
          }
        : {
            status: 'failed',
            message: 'The submission call completed, but the expected workflow transition was not confirmed.',
            details: {
              workflowStage: data.workflow_stage_key,
              workflowStatus: data.workflow_stage_status_key,
              waitingOn: data.workflow_waiting_on_key,
            },
          };
    }

    if (action.toolName === 'record_project_payment') {
      const expectedPaid = Number((result.data as any)?.totalPaid);
      if (!Number.isFinite(expectedPaid)) return null;
      const { data, error } = await supabase
        .from('project_payments')
        .select('project_id,advance_paid,payment_status')
        .eq('project_id', action.payload.projectId)
        .maybeSingle();
      if (error) throw error;
      const actualPaid = Number(data?.advance_paid);
      return data && Number.isFinite(actualPaid) && Math.abs(actualPaid - expectedPaid) < 0.01
        ? {
            status: 'verified',
            message: `Verified in Tracker: project total paid is now ${actualPaid.toFixed(2)} (${data.payment_status}).`,
          }
        : {
            status: 'failed',
            message: 'Tracker verification did not confirm the expected project payment total.',
            details: { actual: actualPaid, expected: expectedPaid },
          };
    }

    if (action.toolName === 'generate_client_invoice') {
      const invoiceId = result.invoice?.id;
      if (!invoiceId) return null;
      const { data, error } = await supabase
        .from('invoices')
        .select('id,invoice_number,client_name,status,total_due')
        .eq('id', invoiceId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            status: 'verified',
            message: `Verified in Tracker: invoice #${data.invoice_number} for ${data.client_name} is saved with status ${data.status}.`,
          }
        : { status: 'failed', message: 'Invoice generation returned success, but the invoice could not be found in Tracker.' };
    }

    if (action.toolName === 'delete_task') {
      const { data, error } = await supabase.from('tasks').select('id').eq('id', action.payload.taskId).maybeSingle();
      if (error) throw error;
      return !data
        ? { status: 'verified', message: 'Verified in Tracker: the task is no longer present.' }
        : { status: 'failed', message: 'The task is still present after the delete action.' };
    }

    if (action.toolName === 'delete_project') {
      const { data, error } = await supabase.from('projects').select('id').eq('id', action.payload.projectId).maybeSingle();
      if (error) throw error;
      return !data
        ? { status: 'verified', message: 'Verified in Tracker: the project is no longer present.' }
        : { status: 'failed', message: 'The project is still present after the delete action.' };
    }

    return null;
  } catch (error: any) {
    return {
      status: 'unverified',
      message: `Action completed, but live verification could not be completed: ${error?.message || 'verification unavailable'}.`,
    };
  }
}
