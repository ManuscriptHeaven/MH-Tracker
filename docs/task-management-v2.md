# Task Management V2 architecture

## Existing flow discovered

- `useTracker` is the application data boundary. It loads `tasks` from Supabase, normalizes nullable/legacy rows, owns create/update mutations, and provides role-scoped task collections to `App`.
- `App` routes `visibleTasks` to **My Tasks**, `teamTasks` to **Team Tasks**, and the full task collection to project details, Team metrics, Communication, and the AI assistant.
- `TasksPage` previously provided list filtering, creation, status changes, due/overdue display, and the legacy single `assigned_to` field.
- Projects remain the parent business object for task authorization and display. Team metrics count primary assignments. Project details show tasks linked through `project_id`.
- Phase 6 replaced the older broad policies with `phase6_can_access_task`, `phase6_team_can_access_project`, active-role normalization, column grants, and an employee mutation guard. Clients cannot access tasks.
- `activity_logs` is already the generic audit stream. It supports project activity metadata and is extended with `task_id` rather than duplicated.

## V2 boundaries

- `tasks.assigned_to` stays the primary and backwards-compatible assignee. A trigger mirrors it into one `task_assignees` row with role `primary`.
- Collaborators and reviewers live in `task_assignees`. The task access helper recognizes those assignments.
- Subtasks use `tasks.parent_task_id`; no parallel subtask table is introduced.
- Comments, checklist items, and dependencies are separate task-owned tables with RLS based on the existing task helper.
- `visibility='private'` restricts project-derived and manager-wide access to directly involved users; existing rows default to `team`.
- Archival uses `archived_at`; active UI collections omit archived tasks and no destructive delete operation is exposed.
- The task detail UI is isolated in `TaskDetailModal`, while `TasksPage` remains the list/filter/create surface.

## Deployment order

1. Review and apply `00600_task_management_v2.sql`, followed by `00610_task_management_v2_advisor_fixes.sql`, to a verified staging project.
2. Run database/RLS integration tests as admin, project manager, employee, collaborator and client.
3. Review Supabase security and performance advisors.
4. Deploy the frontend after the migration. The loader tolerates missing V2 child tables and create/update retries the legacy payload, but V2 collaboration features require the migration.

## Staging validation

- Verified staging project ref: `atazylptnaonohucldfg`.
- Production ref `emhvwdhdmajpakoscuyn` was identified from the repository deployment script and was not modified.
- `00600` and the append-only `00610` advisor correction were rehearsed with rollback, then applied only to verified staging.
- The PostgreSQL role/integrity suite passed after application and rolled back every synthetic Auth/profile/task fixture.
- Pre/post counts remained 9 projects, 4 profiles, 3 team members, 0 tasks, 0 activity rows, and 0 finance transactions.
- Task V2 introduced no unresolved security-advisor finding. The three required new FK indexes appear as unused on the empty staging task dataset, as expected until workload exists.
