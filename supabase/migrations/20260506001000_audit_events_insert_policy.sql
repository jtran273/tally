create policy audit_events_insert_own
  on public.audit_events
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (actor_id is null or actor_id = auth.uid())
  );
