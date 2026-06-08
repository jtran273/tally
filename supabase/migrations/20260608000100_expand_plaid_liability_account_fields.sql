alter type public.account_type add value if not exists 'loan';

create type public.account_liability_kind as enum (
  'credit_card',
  'student_loan',
  'mortgage',
  'other_loan',
  'other_credit'
);

alter table public.accounts
  add column if not exists liability_kind public.account_liability_kind,
  add column if not exists liability_is_overdue boolean,
  add column if not exists liability_last_payment_date date,
  add column if not exists liability_last_payment_amount numeric(14, 2),
  add column if not exists liability_next_payment_amount numeric(14, 2),
  add column if not exists liability_interest_rate_percentage numeric(8, 4),
  add column if not exists liability_origination_principal_amount numeric(14, 2),
  add column if not exists liability_origination_date date,
  add column if not exists liability_expected_payoff_date date,
  add column if not exists liability_loan_name text,
  add column if not exists liability_loan_status text,
  add column if not exists liability_repayment_plan text,
  add column if not exists liability_past_due_amount numeric(14, 2);
