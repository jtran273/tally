-- Track pending-to-posted Plaid replacements separately from ordinary
-- added/modified/removed sync churn so visible changes can be explained.
alter table public.plaid_sync_runs
  add column if not exists pending_transactions_replaced integer not null default 0;

alter table public.plaid_sync_run_items
  add column if not exists pending_transactions_replaced integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'plaid_sync_runs_pending_replacements_non_negative'
      and conrelid = 'public.plaid_sync_runs'::regclass
  ) then
    alter table public.plaid_sync_runs
      add constraint plaid_sync_runs_pending_replacements_non_negative
      check (pending_transactions_replaced >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'plaid_sync_run_items_pending_replacements_non_negative'
      and conrelid = 'public.plaid_sync_run_items'::regclass
  ) then
    alter table public.plaid_sync_run_items
      add constraint plaid_sync_run_items_pending_replacements_non_negative
      check (pending_transactions_replaced >= 0);
  end if;
end $$;

notify pgrst, 'reload schema';
