-- Adds Plaid liabilities-product fields to credit-card accounts so the
-- dashboard credit-card action panel and the reported-balance optimizer can
-- show real statement-close dates and minimums instead of estimating from
-- transaction history.

alter table public.accounts
  add column if not exists last_statement_issue_date date,
  add column if not exists last_statement_balance numeric(14, 2),
  add column if not exists next_payment_due_date date,
  add column if not exists minimum_payment_amount numeric(14, 2);

comment on column public.accounts.last_statement_issue_date is
  'Plaid liabilities: most recent statement close date for the account.';
comment on column public.accounts.last_statement_balance is
  'Plaid liabilities: balance reported on the most recent statement.';
comment on column public.accounts.next_payment_due_date is
  'Plaid liabilities: next payment due date for the credit card.';
comment on column public.accounts.minimum_payment_amount is
  'Plaid liabilities: minimum payment owed on the upcoming due date.';
