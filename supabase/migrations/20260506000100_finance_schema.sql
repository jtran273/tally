create extension if not exists pgcrypto;

create type public.account_type as enum (
  'depository',
  'credit',
  'investment',
  'retirement'
);

create type public.plaid_item_status as enum (
  'active',
  'error',
  'revoked'
);

create type public.plaid_sync_run_source as enum (
  'initial',
  'manual',
  'scheduled'
);

create type public.plaid_sync_run_status as enum (
  'running',
  'succeeded',
  'partial',
  'failed'
);

create type public.transaction_status as enum (
  'pending',
  'posted'
);

create type public.transaction_intent as enum (
  'personal',
  'business',
  'shared',
  'reimbursable',
  'transfer'
);

create type public.review_reason as enum (
  'venmo',
  'large',
  'transfer-pair',
  'new-recurring',
  'low-confidence',
  'missing-category',
  'unclear-transfer',
  'recurring-candidate'
);

create type public.review_status as enum (
  'open',
  'resolved',
  'dismissed'
);

create type public.recurring_cadence as enum (
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annual'
);

create type public.recurring_status as enum (
  'active',
  'pending',
  'paused',
  'dismissed'
);

create type public.reimbursement_status as enum (
  'expected',
  'requested',
  'received',
  'written-off'
);

create type public.insight_tone as enum (
  'info',
  'warn',
  'ok'
);

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  plaid_institution_id text,
  logo_url text,
  primary_color text,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint institutions_id_user_id_unique unique (id, user_id),
  constraint institutions_user_name_unique unique (user_id, name),
  constraint institutions_user_plaid_unique unique (user_id, plaid_institution_id),
  constraint institutions_name_not_blank check (length(btrim(name)) > 0)
);

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  institution_id uuid not null,
  plaid_item_id text not null,
  access_token_ciphertext text not null,
  status public.plaid_item_status not null default 'active',
  available_products text[] not null default '{}',
  billed_products text[] not null default '{}',
  error_code text,
  error_message text,
  consent_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  transaction_cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plaid_items_id_user_id_unique unique (id, user_id),
  constraint plaid_items_user_plaid_unique unique (user_id, plaid_item_id),
  constraint plaid_items_institution_user_fk foreign key (institution_id, user_id)
    references public.institutions (id, user_id) on delete cascade,
  constraint plaid_items_plaid_id_not_blank check (length(btrim(plaid_item_id)) > 0)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  institution_id uuid not null,
  plaid_item_id uuid not null,
  plaid_account_id text not null,
  name text not null,
  official_name text,
  type public.account_type not null,
  subtype text,
  mask text,
  current_balance numeric(14, 2) not null default 0,
  available_balance numeric(14, 2),
  credit_limit numeric(14, 2),
  iso_currency_code text not null default 'USD',
  color text,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_id_user_id_unique unique (id, user_id),
  constraint accounts_user_plaid_unique unique (user_id, plaid_account_id),
  constraint accounts_institution_user_fk foreign key (institution_id, user_id)
    references public.institutions (id, user_id) on delete cascade,
  constraint accounts_plaid_item_user_fk foreign key (plaid_item_id, user_id)
    references public.plaid_items (id, user_id) on delete cascade,
  constraint accounts_name_not_blank check (length(btrim(name)) > 0),
  constraint accounts_credit_limit_non_negative check (credit_limit is null or credit_limit >= 0),
  constraint accounts_currency_format check (iso_currency_code ~ '^[A-Z]{3}$')
);

create table public.plaid_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source public.plaid_sync_run_source not null,
  status public.plaid_sync_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_items integer not null default 0,
  succeeded_items integer not null default 0,
  failed_items integer not null default 0,
  accounts_upserted integer not null default 0,
  balance_snapshots_upserted integer not null default 0,
  raw_transactions_upserted integer not null default 0,
  raw_transactions_skipped integer not null default 0,
  enriched_transactions_inserted integer not null default 0,
  enriched_transactions_updated integer not null default 0,
  transactions_removed integer not null default 0,
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plaid_sync_runs_id_user_id_unique unique (id, user_id),
  constraint plaid_sync_runs_item_counts_non_negative check (
    total_items >= 0 and succeeded_items >= 0 and failed_items >= 0
  ),
  constraint plaid_sync_runs_count_totals_match check (succeeded_items + failed_items <= total_items),
  constraint plaid_sync_runs_row_counts_non_negative check (
    accounts_upserted >= 0
    and balance_snapshots_upserted >= 0
    and raw_transactions_upserted >= 0
    and raw_transactions_skipped >= 0
    and enriched_transactions_inserted >= 0
    and enriched_transactions_updated >= 0
    and transactions_removed >= 0
  )
);

create table public.plaid_sync_run_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  sync_run_id uuid not null,
  plaid_item_id uuid not null,
  status public.plaid_sync_run_status not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  accounts_upserted integer not null default 0,
  balance_snapshots_upserted integer not null default 0,
  raw_transactions_upserted integer not null default 0,
  raw_transactions_skipped integer not null default 0,
  enriched_transactions_inserted integer not null default 0,
  enriched_transactions_updated integer not null default 0,
  transactions_removed integer not null default 0,
  safe_error_code text,
  safe_error_message text,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  constraint plaid_sync_run_items_run_user_fk foreign key (sync_run_id, user_id)
    references public.plaid_sync_runs (id, user_id) on delete cascade,
  constraint plaid_sync_run_items_plaid_item_user_fk foreign key (plaid_item_id, user_id)
    references public.plaid_items (id, user_id) on delete cascade,
  constraint plaid_sync_run_items_one_per_item unique (sync_run_id, plaid_item_id),
  constraint plaid_sync_run_items_final_status check (status in ('succeeded', 'failed')),
  constraint plaid_sync_run_items_row_counts_non_negative check (
    accounts_upserted >= 0
    and balance_snapshots_upserted >= 0
    and raw_transactions_upserted >= 0
    and raw_transactions_skipped >= 0
    and enriched_transactions_inserted >= 0
    and enriched_transactions_updated >= 0
    and transactions_removed >= 0
  )
);

create table public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  snapshot_date date not null,
  current_balance numeric(14, 2) not null,
  available_balance numeric(14, 2),
  credit_limit numeric(14, 2),
  iso_currency_code text not null default 'USD',
  source text not null default 'plaid',
  created_at timestamptz not null default now(),
  constraint balance_snapshots_id_user_id_unique unique (id, user_id),
  constraint balance_snapshots_user_account_date_unique unique (user_id, account_id, snapshot_date),
  constraint balance_snapshots_account_user_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade,
  constraint balance_snapshots_currency_format check (iso_currency_code ~ '^[A-Z]{3}$')
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  parent_id uuid,
  name text not null,
  color text,
  icon text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_id_user_id_unique unique (id, user_id),
  constraint categories_user_name_unique unique (user_id, name),
  constraint categories_parent_user_fk foreign key (parent_id, user_id)
    references public.categories (id, user_id),
  constraint categories_name_not_blank check (length(btrim(name)) > 0)
);

create table public.raw_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  plaid_item_id uuid not null,
  plaid_transaction_id text not null,
  date date not null,
  authorized_date date,
  datetime timestamptz,
  authorized_datetime timestamptz,
  name text not null,
  merchant_name text,
  amount numeric(14, 2) not null,
  iso_currency_code text not null default 'USD',
  status public.transaction_status not null default 'posted',
  pending_transaction_id text,
  payment_channel text,
  plaid_category text,
  plaid_category_id text,
  transaction_type text,
  location jsonb not null default '{}'::jsonb,
  payment_meta jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_transactions_id_user_id_unique unique (id, user_id),
  constraint raw_transactions_user_plaid_unique unique (user_id, plaid_transaction_id),
  constraint raw_transactions_account_user_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade,
  constraint raw_transactions_plaid_item_user_fk foreign key (plaid_item_id, user_id)
    references public.plaid_items (id, user_id) on delete cascade,
  constraint raw_transactions_name_not_blank check (length(btrim(name)) > 0),
  constraint raw_transactions_currency_format check (iso_currency_code ~ '^[A-Z]{3}$')
);

create table public.enriched_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  raw_transaction_id uuid not null,
  account_id uuid not null,
  category_id uuid,
  date date not null,
  merchant_name text not null,
  category_name text not null default 'Uncategorized',
  intent public.transaction_intent not null default 'personal',
  amount numeric(14, 2) not null,
  status public.transaction_status not null default 'posted',
  confidence numeric(5, 4) not null default 0.9500,
  note text not null default '',
  is_recurring boolean not null default false,
  reviewed_at timestamptz,
  source text not null default 'rule',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enriched_transactions_id_user_id_unique unique (id, user_id),
  constraint enriched_transactions_user_raw_unique unique (user_id, raw_transaction_id),
  constraint enriched_transactions_raw_user_fk foreign key (raw_transaction_id, user_id)
    references public.raw_transactions (id, user_id) on delete cascade,
  constraint enriched_transactions_account_user_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade,
  constraint enriched_transactions_category_user_fk foreign key (category_id, user_id)
    references public.categories (id, user_id),
  constraint enriched_transactions_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint enriched_transactions_merchant_not_blank check (length(btrim(merchant_name)) > 0),
  constraint enriched_transactions_category_not_blank check (length(btrim(category_name)) > 0),
  constraint enriched_transactions_source_valid check (source in ('seed', 'plaid', 'manual', 'rule', 'ai'))
);

create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  merchant_pattern text not null,
  normalized_merchant_name text,
  category_id uuid,
  intent public.transaction_intent,
  is_recurring boolean,
  min_amount numeric(14, 2),
  max_amount numeric(14, 2),
  priority integer not null default 100,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_rules_id_user_id_unique unique (id, user_id),
  constraint merchant_rules_user_pattern_priority_unique unique (user_id, merchant_pattern, priority),
  constraint merchant_rules_category_user_fk foreign key (category_id, user_id)
    references public.categories (id, user_id),
  constraint merchant_rules_pattern_not_blank check (length(btrim(merchant_pattern)) > 0),
  constraint merchant_rules_amount_range check (
    min_amount is null
    or max_amount is null
    or min_amount <= max_amount
  )
);

create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  enriched_transaction_id uuid not null,
  reason public.review_reason not null,
  status public.review_status not null default 'open',
  explanation text not null,
  ai_suggestion jsonb not null default '{}'::jsonb,
  confidence numeric(5, 4),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_items_id_user_id_unique unique (id, user_id),
  constraint review_items_user_transaction_reason_unique unique (user_id, enriched_transaction_id, reason),
  constraint review_items_enriched_transaction_user_fk foreign key (enriched_transaction_id, user_id)
    references public.enriched_transactions (id, user_id) on delete cascade,
  constraint review_items_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint review_items_resolution_consistent check (
    (status = 'open' and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  enriched_transaction_id uuid not null,
  category_id uuid,
  label text not null,
  intent public.transaction_intent not null,
  amount numeric(14, 2) not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_splits_id_user_id_unique unique (id, user_id),
  constraint transaction_splits_enriched_transaction_user_fk foreign key (enriched_transaction_id, user_id)
    references public.enriched_transactions (id, user_id) on delete cascade,
  constraint transaction_splits_category_user_fk foreign key (category_id, user_id)
    references public.categories (id, user_id),
  constraint transaction_splits_label_not_blank check (length(btrim(label)) > 0),
  constraint transaction_splits_amount_non_negative check (amount >= 0)
);

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  merchant_rule_id uuid,
  category_id uuid,
  account_id uuid,
  last_transaction_id uuid,
  merchant_name text not null,
  amount numeric(14, 2) not null,
  cadence public.recurring_cadence not null,
  next_due_date date not null,
  last_charge_date date,
  last_amount numeric(14, 2),
  status public.recurring_status not null default 'pending',
  is_new boolean not null default false,
  confidence numeric(5, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_expenses_id_user_id_unique unique (id, user_id),
  constraint recurring_expenses_user_merchant_cadence_unique unique (user_id, merchant_name, cadence),
  constraint recurring_expenses_merchant_rule_user_fk foreign key (merchant_rule_id, user_id)
    references public.merchant_rules (id, user_id),
  constraint recurring_expenses_category_user_fk foreign key (category_id, user_id)
    references public.categories (id, user_id),
  constraint recurring_expenses_account_user_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id),
  constraint recurring_expenses_last_transaction_user_fk foreign key (last_transaction_id, user_id)
    references public.enriched_transactions (id, user_id),
  constraint recurring_expenses_merchant_not_blank check (length(btrim(merchant_name)) > 0),
  constraint recurring_expenses_amount_positive check (amount > 0),
  constraint recurring_expenses_last_amount_non_negative check (last_amount is null or last_amount >= 0),
  constraint recurring_expenses_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table public.reimbursement_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  enriched_transaction_id uuid not null,
  split_id uuid,
  received_transaction_id uuid,
  counterparty text,
  expected_amount numeric(14, 2) not null,
  received_amount numeric(14, 2) not null default 0,
  status public.reimbursement_status not null default 'expected',
  due_date date,
  received_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reimbursement_records_id_user_id_unique unique (id, user_id),
  constraint reimbursement_records_enriched_transaction_user_fk foreign key (enriched_transaction_id, user_id)
    references public.enriched_transactions (id, user_id) on delete cascade,
  constraint reimbursement_records_split_user_fk foreign key (split_id, user_id)
    references public.transaction_splits (id, user_id),
  constraint reimbursement_records_received_transaction_user_fk foreign key (received_transaction_id, user_id)
    references public.enriched_transactions (id, user_id),
  constraint reimbursement_records_expected_amount_positive check (expected_amount > 0),
  constraint reimbursement_records_received_amount_non_negative check (received_amount >= 0)
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  insight_key text not null,
  title text not null,
  body text not null,
  tone public.insight_tone not null default 'info',
  action_label text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insights_id_user_id_unique unique (id, user_id),
  constraint insights_user_key_unique unique (user_id, insight_key),
  constraint insights_key_not_blank check (length(btrim(insight_key)) > 0),
  constraint insights_title_not_blank check (length(btrim(title)) > 0),
  constraint insights_status_valid check (status in ('active', 'dismissed', 'expired'))
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entity_table text not null,
  entity_id uuid,
  action text not null,
  actor_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_id_user_id_unique unique (id, user_id),
  constraint audit_events_entity_table_not_blank check (length(btrim(entity_table)) > 0),
  constraint audit_events_action_not_blank check (length(btrim(action)) > 0)
);

create unique index reimbursement_records_user_split_unique
  on public.reimbursement_records (user_id, split_id)
  where split_id is not null;

create index institutions_user_idx on public.institutions (user_id);
create index plaid_items_user_status_idx on public.plaid_items (user_id, status);
create index plaid_sync_runs_user_started_idx on public.plaid_sync_runs (user_id, started_at desc);
create index plaid_sync_run_items_user_run_idx on public.plaid_sync_run_items (user_id, sync_run_id);
create index plaid_sync_run_items_user_item_completed_idx on public.plaid_sync_run_items (user_id, plaid_item_id, completed_at desc);
create index accounts_user_type_idx on public.accounts (user_id, type);
create index accounts_user_institution_idx on public.accounts (user_id, institution_id);
create index balance_snapshots_user_date_idx on public.balance_snapshots (user_id, snapshot_date desc);
create index balance_snapshots_user_account_date_idx on public.balance_snapshots (user_id, account_id, snapshot_date desc);
create index categories_user_parent_idx on public.categories (user_id, parent_id);
create index raw_transactions_user_account_date_idx on public.raw_transactions (user_id, account_id, date desc);
create index raw_transactions_user_date_idx on public.raw_transactions (user_id, date desc);
create index enriched_transactions_user_date_idx on public.enriched_transactions (user_id, date desc);
create index enriched_transactions_user_account_date_idx on public.enriched_transactions (user_id, account_id, date desc);
create index enriched_transactions_user_category_idx on public.enriched_transactions (user_id, category_id);
create index enriched_transactions_user_intent_idx on public.enriched_transactions (user_id, intent);
create index enriched_transactions_user_merchant_lower_idx on public.enriched_transactions (user_id, lower(merchant_name));
create index merchant_rules_user_enabled_priority_idx on public.merchant_rules (user_id, enabled, priority);
create index review_items_user_status_reason_idx on public.review_items (user_id, status, reason);
create index review_items_user_transaction_idx on public.review_items (user_id, enriched_transaction_id);
create index transaction_splits_user_transaction_idx on public.transaction_splits (user_id, enriched_transaction_id);
create index recurring_expenses_user_status_next_idx on public.recurring_expenses (user_id, status, next_due_date);
create index reimbursement_records_user_status_idx on public.reimbursement_records (user_id, status);
create index insights_user_status_generated_idx on public.insights (user_id, status, generated_at desc);
create index audit_events_user_created_idx on public.audit_events (user_id, created_at desc);
create index audit_events_user_entity_idx on public.audit_events (user_id, entity_table, entity_id);

revoke select (access_token_ciphertext) on public.plaid_items from anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'institutions',
    'plaid_items',
    'plaid_sync_runs',
    'plaid_sync_run_items',
    'accounts',
    'categories',
    'raw_transactions',
    'enriched_transactions',
    'merchant_rules',
    'review_items',
    'transaction_splits',
    'recurring_expenses',
    'reimbursement_records',
    'insights'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'institutions',
    'plaid_items',
    'plaid_sync_runs',
    'plaid_sync_run_items',
    'accounts',
    'balance_snapshots',
    'categories',
    'raw_transactions',
    'enriched_transactions',
    'merchant_rules',
    'review_items',
    'transaction_splits',
    'recurring_expenses',
    'reimbursement_records',
    'insights',
    'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)',
      table_name || '_select_own',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'institutions',
    'plaid_items',
    'plaid_sync_runs',
    'accounts',
    'balance_snapshots',
    'categories',
    'enriched_transactions',
    'merchant_rules',
    'review_items',
    'transaction_splits',
    'recurring_expenses',
    'reimbursement_records',
    'insights'
  ]
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
      table_name || '_insert_own',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      table_name || '_update_own',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
      table_name || '_delete_own',
      table_name
    );
  end loop;
end $$;
