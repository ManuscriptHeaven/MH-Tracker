# Basic Agent v1

This is the first deliberately narrow slice of the MH Tracker agent. It answers six read-only questions about project and task counts, overdue items, and items due today. The chat and voice interface is reused, but answers are computed locally from the tracker’s already-visible records. No model API, database write, action executor, or new production secret is used.

## Safety boundary

- The agent receives only `visibleProjects` and the task list available to the current manager (`teamTasks`) or other user (`visibleTasks`). It receives no finance, message, payroll, or mutation functions.
- Write-like requests are refused. Unsupported questions receive an explicit limitation, not a fabricated answer.
- Responses render as React text, so project or task titles cannot inject HTML into chat.
- The former action engine remains in the repository for future review, but the active chat path no longer calls it and the confirmation callback does not execute actions.
- Chat messages are in-memory for this slice; do not treat them as an audit log.

## Verification

Run `npm run test:basic-agent` and `npm run build`. The focused tests cover each supported intent, closed/done exclusions, refusal of write requests, empty data, and literal rendering of malicious-looking titles. The repository’s older `npm test` suite still exercises the legacy voice/action engine and currently fails 26 of 54 checks; those failures should be addressed before that engine is ever re-enabled.

## Next increments

1. Add a small authenticated, read-only server endpoint for data the browser cannot safely scope, with role-aware authorization and bounded responses.
2. Add model-based language understanding only after privacy, provider, cost, and abuse limits are approved. Keep tool selection and authorization outside the model.
3. Evaluate real user questions, unsupported cases, and role boundaries before expanding to any write capability. Any write action needs server-side authorization, preview, explicit confirmation, idempotency, and an audit trail.
