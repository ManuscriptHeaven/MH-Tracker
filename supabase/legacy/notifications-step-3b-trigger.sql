revoke all on function public.create_project_notifications() from public;

drop trigger if exists project_notifications_trigger on public.projects;

create trigger project_notifications_trigger
after insert or update on public.projects
for each row execute function public.create_project_notifications();
