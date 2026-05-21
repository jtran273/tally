create index if not exists plaid_sync_runs_user_status_started_idx on public.plaid_sync_runs (user_id, status, started_at desc);
notify pgrst, 'reload schema';
