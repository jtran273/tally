alter table public.plaid_items
  add column if not exists auto_sync_enabled boolean not null default true;

notify pgrst, 'reload schema';
