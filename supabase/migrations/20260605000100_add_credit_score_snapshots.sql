create table if not exists public.credit_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null check (score between 300 and 850),
  source text not null check (source in ('manual_bureau', 'manual_issuer', 'demo')),
  model text not null check (model in ('fico', 'vantagescore', 'unknown')),
  as_of_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_score_snapshots_user_date_idx
  on public.credit_score_snapshots(user_id, as_of_date desc, created_at desc);

alter table public.credit_score_snapshots enable row level security;

drop policy if exists "Users can read their own credit score snapshots" on public.credit_score_snapshots;
create policy "Users can read their own credit score snapshots"
  on public.credit_score_snapshots
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own credit score snapshots" on public.credit_score_snapshots;
create policy "Users can insert their own credit score snapshots"
  on public.credit_score_snapshots
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own credit score snapshots" on public.credit_score_snapshots;
create policy "Users can update their own credit score snapshots"
  on public.credit_score_snapshots
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own credit score snapshots" on public.credit_score_snapshots;
create policy "Users can delete their own credit score snapshots"
  on public.credit_score_snapshots
  for delete
  using (auth.uid() = user_id);
