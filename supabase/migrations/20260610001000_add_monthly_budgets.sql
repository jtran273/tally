create table if not exists public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  month text not null,
  status text not null default 'confirmed',
  total_amount numeric(12, 2) not null,
  categories jsonb not null default '[]'::jsonb,
  source_proposal_id uuid,
  confirmed_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_budgets_id_user_id_unique unique (id, user_id),
  constraint monthly_budgets_month_format check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint monthly_budgets_status_valid check (status in ('confirmed', 'superseded')),
  constraint monthly_budgets_total_positive check (total_amount > 0),
  constraint monthly_budgets_categories_array check (jsonb_typeof(categories) = 'array')
);

create unique index if not exists monthly_budgets_one_confirmed_per_month_idx
  on public.monthly_budgets (user_id, month)
  where status = 'confirmed';

create index if not exists monthly_budgets_user_month_idx
  on public.monthly_budgets (user_id, month, status);

alter table public.monthly_budgets enable row level security;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
    and not exists (
      select 1
      from pg_trigger
      where tgname = 'monthly_budgets_set_updated_at'
        and tgrelid = 'public.monthly_budgets'::regclass
    )
  then
    create trigger monthly_budgets_set_updated_at
      before update on public.monthly_budgets
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'monthly_budgets'
      and policyname = 'monthly_budgets_select_own'
  ) then
    create policy monthly_budgets_select_own
      on public.monthly_budgets
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- Confirmed budgets are written only by Tally-owned approval flows running
-- with the service role; browser sessions can read but never write them.
revoke insert, update, delete on public.monthly_budgets from anon, authenticated;

notify pgrst, 'reload schema';
