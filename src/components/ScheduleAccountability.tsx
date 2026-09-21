import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  MessageSquare,
  Send,
  TimerReset,
  X,
} from 'lucide-react';
import { formatDate } from '../lib/date';
import {
  formatClockDuration,
  getProjectClockSnapshot,
  originalProjectDueDate,
  projectDueShiftDays,
  projectedFinalDueDate,
} from '../lib/timeline';
import type {
  ChatMessage,
  Conversation,
  Project,
  ProjectClientReminder,
  ProjectDelayMetrics,
} from '../lib/types';
import { Button, Card, Modal, TextareaField } from './ui';

function metricDuration(seconds?: number | null) {
  return formatClockDuration(Math.max(0, Number(seconds || 0)));
}

export function ScheduleAccountability({
  project,
  reminders = [],
  metrics,
  onSendMessage,
  onGetOrCreateProjectConversation,
  onResolveReminder,
}: {
  project: Project;
  reminders?: ProjectClientReminder[];
  metrics?: ProjectDelayMetrics;
  onSendMessage?: (
    conversationId: string,
    body: string,
    attachments?: { file: File; file_name: string; file_type: string; file_size: number }[],
    parentMessageId?: string | null,
  ) => Promise<ChatMessage>;
  onGetOrCreateProjectConversation?: (projectId: string, isInternal: boolean) => Promise<Conversation>;
  onResolveReminder?: (reminderId: string, status: 'sent' | 'dismissed') => Promise<void>;
}) {
  const [selectedReminder, setSelectedReminder] = useState<ProjectClientReminder | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const clock = getProjectClockSnapshot(project);
  const originalDue = originalProjectDueDate(project);
  const currentDue = projectedFinalDueDate(project);
  const shiftDays = projectDueShiftDays(project);

  const pendingReminder = useMemo(
    () =>
      reminders
        .filter((item) => item.project_id === project.id && item.status === 'pending')
        .sort(
          (a, b) =>
            b.threshold_hours - a.threshold_hours ||
            new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime(),
        )[0] || null,
    [project.id, reminders],
  );

  const openReminder = () => {
    if (!pendingReminder) return;
    setSelectedReminder(pendingReminder);
    setDraftBody(pendingReminder.draft_body);
    setActionError(null);
  };

  const dismissReminder = async () => {
    if (!pendingReminder || !onResolveReminder) return;
    if (!window.confirm(`Dismiss this ${pendingReminder.threshold_hours}h client follow-up draft?`)) return;
    setActionError(null);
    try {
      await onResolveReminder(pendingReminder.id, 'dismissed');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not dismiss this reminder.');
    }
  };

  const sendReminder = async () => {
    if (
      !selectedReminder ||
      !draftBody.trim() ||
      !onSendMessage ||
      !onGetOrCreateProjectConversation ||
      !onResolveReminder
    ) {
      return;
    }

    setIsSending(true);
    setActionError(null);
    try {
      const conversation = await onGetOrCreateProjectConversation(project.id, false);
      await onSendMessage(conversation.id, draftBody.trim());
      await onResolveReminder(selectedReminder.id, 'sent');
      setSelectedReminder(null);
      setDraftBody('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not send the client reminder.');
    } finally {
      setIsSending(false);
    }
  };

  const riskTone =
    clock.riskLevel === 'overdue' || clock.riskLevel === 'red'
      ? 'border-red-200 bg-red-50 text-red-800'
      : clock.riskLevel === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-2 border-b border-border bg-[#fcfbf8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
              <TimerReset className="h-4 w-4 text-gold" />
              Schedule Accountability
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              Separates Manuscript Heaven production time from client-caused waiting time.
            </p>
          </div>
          <span className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${riskTone}`}>
            {clock.riskLabel || 'On track'}
          </span>
        </div>

        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Original Due" value={originalDue ? formatDate(originalDue) : 'Not set'} />
          <Metric
            label="Current Due"
            value={currentDue ? formatDate(currentDue) : 'Not set'}
            helper={shiftDays && shiftDays > 0 ? `+${shiftDays}d client-wait shift` : 'No client shift'}
          />
          <Metric
            label="MH Production"
            value={metricDuration(metrics?.production_seconds ?? project.production_seconds_total)}
            helper="Active production clock"
          />
          <Metric
            label="Client Waiting"
            value={metricDuration(metrics?.client_wait_seconds ?? project.client_wait_seconds_total)}
            helper="Excluded from production"
          />
          <Metric
            label="Internal Overdue"
            value={metricDuration(metrics?.internal_overdue_seconds)}
            helper="Team-owned deadline overrun"
            alert={Number(metrics?.internal_overdue_seconds || 0) > 0}
          />
        </div>

        {pendingReminder ? (
          <div className="border-t border-border bg-violet-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                  <BellRing className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-ink">Client follow-up ready</p>
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                      {pendingReminder.threshold_hours}h
                    </span>
                    {pendingReminder.threshold_hours === 72 ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                        Escalated
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {pendingReminder.wait_reason === 'files'
                      ? 'Client files are still pending.'
                      : 'Client approval or revision feedback is still pending.'}
                    {' '}The draft must be reviewed before it is sent.
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-charcoal">
                    {pendingReminder.draft_body}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => void dismissReminder()} className="text-xs">
                  <X className="h-3.5 w-3.5" />
                  Dismiss
                </Button>
                <Button
                  type="button"
                  onClick={openReminder}
                  disabled={!onSendMessage || !onGetOrCreateProjectConversation || !onResolveReminder}
                  className="text-xs"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Review & Send
                </Button>
              </div>
            </div>
            {actionError ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                {actionError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {selectedReminder ? (
        <Modal
          title={selectedReminder.threshold_hours === 72 ? 'Confirm Escalation Reminder' : 'Confirm Client Reminder'}
          width="max-w-xl"
          onClose={() => {
            if (!isSending) {
              setSelectedReminder(null);
              setActionError(null);
            }
          }}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
              <div className="flex items-start gap-2">
                {selectedReminder.threshold_hours === 72 ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                ) : (
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
                )}
                <div>
                  <p className="text-xs font-bold text-ink">{selectedReminder.draft_subject}</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    This will be sent to the client project conversation only after you press Confirm & Send.
                  </p>
                </div>
              </div>
            </div>

            <TextareaField
              label="Client Message"
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              rows={7}
              disabled={isSending}
            />

            {actionError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                {actionError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="secondary"
                disabled={isSending}
                onClick={() => {
                  setSelectedReminder(null);
                  setActionError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void sendReminder()}
                disabled={isSending || !draftBody.trim()}
              >
                {isSending ? <Clock3 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {isSending ? 'Sending...' : 'Confirm & Send'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  helper,
  alert = false,
}: {
  label: string;
  value: string;
  helper?: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold ${alert ? 'text-red-700' : 'text-ink'}`}>{value}</p>
      {helper ? <p className="mt-0.5 text-[10px] text-muted">{helper}</p> : null}
    </div>
  );
}
