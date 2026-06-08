-- Expands curated Plaid credit-card liability fields. This intentionally keeps
-- the schema card-only; loan, mortgage, and student-loan payloads are not stored.

alter table public.accounts
  add column if not exists liability_is_overdue boolean,
  add column if not exists liability_last_payment_date date,
  add column if not exists liability_last_payment_amount numeric(14, 2),
  add column if not exists liability_aprs jsonb not null default '[]'::jsonb;

comment on column public.accounts.liability_is_overdue is
  'Plaid credit liability: whether the card is currently overdue.';
comment on column public.accounts.liability_last_payment_date is
  'Plaid credit liability: most recent payment date for the card.';
comment on column public.accounts.liability_last_payment_amount is
  'Plaid credit liability: most recent payment amount for the card.';
comment on column public.accounts.liability_aprs is
  'Curated Plaid credit-card APR records: type, APR percentage, subject balance, and interest charge only.';
