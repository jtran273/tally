create table if not exists public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  google_calendar_id text not null,
  calendar_summary text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  scope text not null,
  token_type text not null default 'Bearer',
  expires_at timestamptz not null,
  status text not null default 'active',
  error_code text,
  error_message text,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_id_user_id_unique unique (id, user_id),
  constraint google_calendar_connections_user_calendar_unique unique (user_id, google_calendar_id),
  constraint google_calendar_connections_calendar_id_not_blank check (length(btrim(google_calendar_id)) > 0),
  constraint google_calendar_connections_scope_not_blank check (length(btrim(scope)) > 0),
  constraint google_calendar_connections_token_type_not_blank check (length(btrim(token_type)) > 0),
  constraint google_calendar_connections_status_check check (status in ('active', 'error', 'revoked'))
);

create index if not exists google_calendar_connections_user_status_idx
  on public.google_calendar_connections (user_id, status, created_at desc);

revoke all on table public.google_calendar_connections from anon, authenticated;

grant select (
  id,
  user_id,
  google_calendar_id,
  calendar_summary,
  status,
  error_code,
  error_message,
  last_successful_sync_at,
  created_at,
  updated_at
) on table public.google_calendar_connections to authenticated;

grant all on table public.google_calendar_connections to service_role;

alter table public.google_calendar_connections enable row level security;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
    and not exists (
      select 1
      from pg_trigger
      where tgname = 'google_calendar_connections_set_updated_at'
        and tgrelid = 'public.google_calendar_connections'::regclass
    )
  then
    create trigger google_calendar_connections_set_updated_at
      before update on public.google_calendar_connections
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'google_calendar_connections'
      and policyname = 'google_calendar_connections_select_own'
  ) then
    create policy google_calendar_connections_select_own
      on public.google_calendar_connections
      for select to authenticated
      using (auth.uid() = user_id);
  end if;

  -- Writes are intentionally service-route-only because this table stores OAuth tokens.
end $$;

notify pgrst, 'reload schema';
