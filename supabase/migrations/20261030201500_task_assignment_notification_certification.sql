-- AI Workflow Certification: persist task assignment notifications.
-- Notification creation is transactional with the task INSERT / reassignment.
-- Read access remains restricted by the existing recipient_id = auth.uid() RLS.
-- Never add a client-side privileged key or an authenticated INSERT policy.
--
-- The app already plays realtime task sounds; this adds an offline-safe inbox
-- entry and does not attempt to deliver email/push notifications.

CREATE OR REPLACE FUNCTION public.task_assignment_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_recipient uuid;
  v_actor uuid;
  v_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;

  v_recipient := NEW.assigned_to;
  v_actor := auth.uid();

  -- Self assignments are visible immediately in the actor's task list.
  -- Never notify clients or inactive profiles.
  IF v_recipient IS NULL OR v_recipient IS NOT DISTINCT FROM v_actor THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_recipient
      AND p.status = 'active'
      AND p.role::text IN ('admin', 'project_manager', 'manager', 'employee', 'junior_assistant')
  ) INTO v_active;

  IF NOT v_active THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications
    (recipient_id, project_id, type, title, message, is_read)
  VALUES
    (v_recipient, NEW.project_id, 'task_assigned',
     CASE WHEN TG_OP = 'INSERT' THEN 'New task assigned' ELSE 'Task reassigned to you' END,
     left(NEW.title, 180), false);

  RETURN NEW;
END
$function$;

-- No direct RPC access to a privileged function is needed.
REVOKE ALL ON FUNCTION public.task_assignment_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS task_assignment_persistent_notification ON public.tasks;
CREATE TRIGGER task_assignment_persistent_notification
AFTER INSERT OR UPDATE OF assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.task_assignment_notify();

COMMENT ON FUNCTION public.task_assignment_notify()
IS 'SECURITY DEFINER task trigger: atomic recipient-only notification on new assignment; no caller EXECUTE grant.';
