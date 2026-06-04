do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'anomaly_alert_severity'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.anomaly_alert_severity as enum (
      'info',
      'warning',
      'critical'
    );
  end if;

  if not exists (
    select 1
    from pg_type
    where typname = 'anomaly_alert_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.anomaly_alert_status as enum (
      'pending',
      'dismissed',
      'resolved'
    );
  end if;

  if not exists (
    select 1
    from pg_type
    where typname = 'anomaly_alert_reason_code'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.anomaly_alert_reason_code as enum (
      'duplicate_charge',
      'subscription_increase',
      'unusual_merchant',
      'large_transaction',
      'category_spike',
      'overdue_reimbursement',
      'high_card_balance',
      'stale_sync'
    );
  end if;
end $$;

create table if not exists public.anomaly_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  reason_code public.anomaly_alert_reason_code not null,
  severity public.anomaly_alert_severity not null,
  status public.anomaly_alert_status not null default 'pending',
  dedupe_key text not null,
  title text not null,
  body text not null,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  dismissed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint anomaly_alerts_id_user_id_unique unique (id, user_id),
  constraint anomaly_alerts_user_dedupe_unique unique (user_id, dedupe_key),
  constraint anomaly_alerts_dedupe_key_not_blank check (length(btrim(dedupe_key)) > 0),
  constraint anomaly_alerts_title_not_blank check (length(btrim(title)) > 0),
  constraint anomaly_alerts_body_not_blank check (length(btrim(body)) > 0),
  constraint anomaly_alerts_evidence_object check (jsonb_typeof(evidence) = 'object')
);

create index if not exists anomaly_alerts_user_status_severity_idx
  on public.anomaly_alerts (user_id, status, severity, detected_at desc);

create index if not exists anomaly_alerts_user_reason_idx
  on public.anomaly_alerts (user_id, reason_code, detected_at desc);

revoke all on table public.anomaly_alerts from anon, authenticated;
grant select on table public.anomaly_alerts to authenticated;
grant all on table public.anomaly_alerts to service_role;

alter table public.anomaly_alerts enable row level security;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
    and not exists (
      select 1
      from pg_trigger
      where tgname = 'anomaly_alerts_set_updated_at'
        and tgrelid = 'public.anomaly_alerts'::regclass
    )
  then
    create trigger anomaly_alerts_set_updated_at
      before update on public.anomaly_alerts
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'anomaly_alerts'
      and policyname = 'anomaly_alerts_select_own'
  ) then
    create policy anomaly_alerts_select_own
      on public.anomaly_alerts
      for select to authenticated
      using (auth.uid() = user_id);
  end if;

  drop policy if exists anomaly_alerts_insert_own on public.anomaly_alerts;
  drop policy if exists anomaly_alerts_update_own on public.anomaly_alerts;
  drop policy if exists anomaly_alerts_delete_own on public.anomaly_alerts;
end $$;

notify pgrst, 'reload schema';
