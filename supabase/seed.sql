begin;

insert into public.institutions (
  id,
  user_id,
  name,
  plaid_institution_id,
  primary_color,
  website_url
)
values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Schools First FCU', 'ins_seed_schools_first', '#0a4d8c', 'https://www.schoolsfirstfcu.org'),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Charles Schwab', 'ins_seed_schwab', '#00a0df', 'https://www.schwab.com'),
  ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Goldman Sachs', 'ins_seed_goldman_sachs', '#7a5c2e', 'https://www.marcus.com'),
  ('10000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Chase', 'ins_seed_chase', '#1f3a5f', 'https://www.chase.com'),
  ('10000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Apple', 'ins_seed_apple', '#222222', 'https://www.apple.com/apple-card'),
  ('10000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Discover', 'ins_seed_discover', '#ff6000', 'https://www.discover.com'),
  ('10000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'American Express', 'ins_seed_amex', '#006fcf', 'https://www.americanexpress.com'),
  ('10000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Fidelity', 'ins_seed_fidelity', '#3a7a3a', 'https://www.fidelity.com'),
  ('10000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Vanguard', 'ins_seed_vanguard', '#96151d', 'https://www.vanguard.com')
on conflict (user_id, name) do update set
  plaid_institution_id = excluded.plaid_institution_id,
  primary_color = excluded.primary_color,
  website_url = excluded.website_url;

insert into public.plaid_items (
  id,
  user_id,
  institution_id,
  plaid_item_id,
  access_token_ciphertext,
  status,
  available_products,
  billed_products,
  last_successful_sync_at,
  transaction_cursor
)
values
  ('20000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'item_seed_schools_first', 'seed-token-not-real:schools-first', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-schools-first'),
  ('20000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002', 'item_seed_schwab', 'seed-token-not-real:schwab', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-schwab'),
  ('20000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000003', 'item_seed_goldman_sachs', 'seed-token-not-real:goldman-sachs', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-goldman-sachs'),
  ('20000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000004', 'item_seed_chase', 'seed-token-not-real:chase', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-chase'),
  ('20000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000005', 'item_seed_apple', 'seed-token-not-real:apple', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-apple'),
  ('20000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000006', 'item_seed_discover', 'seed-token-not-real:discover', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-discover'),
  ('20000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000007', 'item_seed_amex', 'seed-token-not-real:amex', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-amex'),
  ('20000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000008', 'item_seed_fidelity', 'seed-token-not-real:fidelity', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-fidelity'),
  ('20000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000009', 'item_seed_vanguard', 'seed-token-not-real:vanguard', 'active', array['auth', 'transactions'], array['transactions'], '2026-05-06 11:58:00-07', 'seed-cursor-vanguard')
on conflict (user_id, plaid_item_id) do update set
  status = excluded.status,
  last_successful_sync_at = excluded.last_successful_sync_at,
  transaction_cursor = excluded.transaction_cursor;

insert into public.accounts (
  id,
  user_id,
  institution_id,
  plaid_item_id,
  plaid_account_id,
  name,
  official_name,
  type,
  subtype,
  mask,
  current_balance,
  available_balance,
  credit_limit,
  color,
  last_synced_at
)
values
  ('30000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'seed-a1', 'Schools First Checking', 'Schools First Checking', 'depository', 'checking', '4412', 6840.22, 6840.22, null, '#0a4d8c', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'seed-a2', 'Charles Schwab Checking', 'Charles Schwab Investor Checking', 'depository', 'checking', '7720', 4203.87, 4203.87, null, '#00a0df', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'seed-a3', 'Marcus Savings (Apple)', 'Marcus Savings', 'depository', 'savings', '2210', 28450.00, 28450.00, null, '#7a5c2e', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'seed-a5', 'Chase Sapphire', 'Chase Sapphire Preferred', 'credit', 'credit card', '4421', -2847.32, 12152.68, 15000.00, '#1f3a5f', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'seed-a6', 'Apple Card', 'Apple Card', 'credit', 'credit card', '0042', -612.40, 7387.60, 8000.00, '#222222', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', 'seed-a7', 'Discover It', 'Discover It', 'credit', 'credit card', '8830', -421.80, 6078.20, 6500.00, '#ff6000', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', 'seed-a8', 'Amex Blue Cash', 'American Express Blue Cash', 'credit', 'credit card', '1006', -1284.50, 10715.50, 12000.00, '#006fcf', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000008', 'seed-a10', 'Fidelity Brokerage', 'Fidelity Brokerage', 'investment', 'brokerage', '7711', 42890.55, 42890.55, null, '#3a7a3a', '2026-05-06 11:58:00-07'),
  ('30000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', 'seed-a11', 'Vanguard Roth IRA', 'Vanguard Roth IRA', 'retirement', 'roth ira', '5523', 18420.10, 18420.10, null, '#96151d', '2026-05-06 11:58:00-07')
on conflict (user_id, plaid_account_id) do update set
  name = excluded.name,
  official_name = excluded.official_name,
  current_balance = excluded.current_balance,
  available_balance = excluded.available_balance,
  credit_limit = excluded.credit_limit,
  color = excluded.color,
  last_synced_at = excluded.last_synced_at;

insert into public.balance_snapshots (
  user_id,
  account_id,
  snapshot_date,
  current_balance,
  available_balance,
  credit_limit,
  source
)
values
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000001', '2026-04-06', 6312.88, 6312.88, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000002', '2026-04-06', 3988.42, 3988.42, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000003', '2026-04-06', 28125.50, 28125.50, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000005', '2026-04-06', -2335.21, 12664.79, 15000.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000006', '2026-04-06', -488.93, 7511.07, 8000.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000007', '2026-04-06', -510.10, 5989.90, 6500.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000008', '2026-04-06', -1032.75, 10967.25, 12000.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000010', '2026-04-06', 41025.00, 41025.00, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000011', '2026-04-06', 17690.50, 17690.50, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000001', '2026-05-06', 6840.22, 6840.22, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000002', '2026-05-06', 4203.87, 4203.87, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000003', '2026-05-06', 28450.00, 28450.00, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000005', '2026-05-06', -2847.32, 12152.68, 15000.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000006', '2026-05-06', -612.40, 7387.60, 8000.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000007', '2026-05-06', -421.80, 6078.20, 6500.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000008', '2026-05-06', -1284.50, 10715.50, 12000.00, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000010', '2026-05-06', 42890.55, 42890.55, null, 'seed'),
  ('11111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000011', '2026-05-06', 18420.10, 18420.10, null, 'seed')
on conflict (user_id, account_id, snapshot_date) do update set
  current_balance = excluded.current_balance,
  available_balance = excluded.available_balance,
  credit_limit = excluded.credit_limit,
  source = excluded.source;

insert into public.categories (
  id,
  user_id,
  name,
  color,
  icon,
  is_system
)
values
  ('40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uncategorized', '#6b7280', 'circle-help', true),
  ('40000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Food / Restaurants', '#dc6b3d', 'utensils', true),
  ('40000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Software / AI Tools', '#3b82f6', 'sparkles', true),
  ('40000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Software / SaaS', '#6366f1', 'cloud', true),
  ('40000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Software / Hosting', '#0f766e', 'server', true),
  ('40000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Health / Fitness', '#16a34a', 'activity', true),
  ('40000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Transport / Rideshare', '#0284c7', 'car', true),
  ('40000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Travel / Flights', '#7c3aed', 'plane', true),
  ('40000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Groceries', '#65a30d', 'shopping-basket', true),
  ('40000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Transfer', '#71717a', 'repeat', true),
  ('40000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Income', '#059669', 'arrow-down', true),
  ('40000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Shopping', '#ea580c', 'shopping-bag', true),
  ('40000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'Housing', '#92400e', 'home', true),
  ('40000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'Health / Pharmacy', '#0891b2', 'pill', true)
on conflict (user_id, name) do update set
  color = excluded.color,
  icon = excluded.icon,
  is_system = excluded.is_system;

insert into public.merchant_rules (
  id,
  user_id,
  merchant_pattern,
  normalized_merchant_name,
  category_id,
  intent,
  is_recurring,
  priority,
  notes
)
values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'SWEETGREEN%', 'Sweetgreen', '40000000-0000-0000-0000-000000000002', 'personal', false, 10, 'Normalize Sweetgreen location strings.'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ANTHROPIC%', 'Anthropic', '40000000-0000-0000-0000-000000000003', 'business', true, 10, 'AI subscription.'),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'CURSOR%', 'Cursor', '40000000-0000-0000-0000-000000000003', 'business', true, 10, 'AI coding subscription.'),
  ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'EQUINOX%', 'Equinox', '40000000-0000-0000-0000-000000000006', 'personal', true, 10, 'Monthly gym membership.'),
  ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'VENMO%', null, '40000000-0000-0000-0000-000000000001', 'shared', null, 5, 'Peer-to-peer transfers require review before trusting spend buckets.'),
  ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'PAYROLL DEPOSIT', 'PAYROLL DEPOSIT', '40000000-0000-0000-0000-000000000011', 'personal', true, 10, 'Biweekly payroll deposit.'),
  ('d0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'NYC RENT%', 'NYC Rent', '40000000-0000-0000-0000-000000000013', 'personal', true, 10, 'Monthly rent.'),
  ('d0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '%CARD PAYMENT%', null, '40000000-0000-0000-0000-000000000010', 'transfer', false, 10, 'Credit-card payments are transfers, not spending.')
on conflict (user_id, merchant_pattern, priority) do update set
  normalized_merchant_name = excluded.normalized_merchant_name,
  category_id = excluded.category_id,
  intent = excluded.intent,
  is_recurring = excluded.is_recurring,
  enabled = true,
  notes = excluded.notes;

create temp table seed_ledger_transactions (
  mock_id text primary key,
  raw_id uuid not null,
  enriched_id uuid not null,
  review_id uuid,
  account_id uuid not null,
  plaid_item_id uuid not null,
  tx_date date not null,
  merchant text not null,
  amount numeric(14, 2) not null,
  category text not null,
  intent public.transaction_intent not null,
  plaid_category text not null,
  plaid_merchant text not null,
  status public.transaction_status not null,
  confidence numeric(5, 4) not null,
  review_reason public.review_reason,
  ai_suggestion jsonb not null default '{}'::jsonb,
  note text not null default '',
  is_recurring boolean not null default false
) on commit drop;

insert into seed_ledger_transactions (
  mock_id,
  raw_id,
  enriched_id,
  review_id,
  account_id,
  plaid_item_id,
  tx_date,
  merchant,
  amount,
  category,
  intent,
  plaid_category,
  plaid_merchant,
  status,
  confidence,
  review_reason,
  ai_suggestion,
  note,
  is_recurring
)
values
  ('t1', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-06', 'Sweetgreen', -16.45, 'Food / Restaurants', 'personal', 'Food / Restaurants', 'SWEETGREEN #0421 NEW YORK', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t2', '50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-06', 'Anthropic', -20.00, 'Software / AI Tools', 'business', 'Service', 'ANTHROPIC PBC SAN FRANC', 'posted', 0.9500, null, '{"category":"Software / AI Tools","from":"Service","confidence":0.97}'::jsonb, '', true),
  ('t3', '50000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-05', 'Venmo - Maya R.', -92.40, 'Uncategorized', 'shared', 'Transfer', 'VENMO CASHOUT MAYA R', 'posted', 0.4200, 'venmo', '{"category":"Food / Restaurants","intent":"shared","confidence":0.72,"reason":"Peer-to-peer payment with a weekend dinner-size amount."}'::jsonb, '', false),
  ('t4', '50000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000004', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-05', 'Cursor', -20.00, 'Software / AI Tools', 'business', 'Service', 'Cursor', 'posted', 0.9500, null, '{"category":"Software / AI Tools","from":"Service","confidence":0.96}'::jsonb, '', true),
  ('t5', '50000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000005', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-04', 'Equinox', -260.00, 'Health / Fitness', 'personal', 'Health / Fitness', 'Equinox', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t6', '50000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000006', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-04', 'Uber', -23.40, 'Transport / Rideshare', 'personal', 'Transport / Rideshare', 'Uber', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t7', '50000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000007', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-03', 'Sweetgreen', -18.20, 'Food / Restaurants', 'personal', 'Food / Restaurants', 'Sweetgreen', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t8', '50000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000008', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-03', 'Linear', -16.00, 'Software / SaaS', 'business', 'Software / SaaS', 'Linear', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t9', '50000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-02', 'Delta Air Lines', -487.20, 'Travel / Flights', 'business', 'Travel / Flights', 'Delta Air Lines', 'posted', 0.7100, 'large', '{"intent":"business","from":"personal","confidence":0.71,"reason":"Looks like work travel based on similar past trips."}'::jsonb, '', false),
  ('t10', '50000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000010', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-02', 'Whole Foods', -82.14, 'Groceries', 'personal', 'Groceries', 'Whole Foods', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t11', '50000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000011', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-01', 'Vercel', -20.00, 'Software / Hosting', 'business', 'Software / Hosting', 'Vercel', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t12', '50000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000012', '70000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-05-01', 'Zelle - Alex K.', -68.00, 'Uncategorized', 'shared', 'Transfer', 'ZELLE PAYMENT TO ALEX K', 'posted', 0.4800, 'venmo', '{"category":"Transport / Rideshare","intent":"shared","confidence":0.63,"reason":"Peer-to-peer transfer. Explain it before Ledger trusts the spend bucket."}'::jsonb, '', false),
  ('t13', '50000000-0000-0000-0000-000000000013', '60000000-0000-0000-0000-000000000013', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-30', 'Joe''s Pizza', -14.50, 'Food / Restaurants', 'personal', 'Food / Restaurants', 'Joe''s Pizza', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t14', '50000000-0000-0000-0000-000000000014', '60000000-0000-0000-0000-000000000014', '70000000-0000-0000-0000-000000000014', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-04-29', 'CHASE PMT THANK YOU', 1200.00, 'Transfer', 'transfer', 'Payment', 'CHASE PMT THANK YOU', 'posted', 0.6000, 'transfer-pair', '{"intent":"transfer","confidence":0.60,"reason":"Possible matching credit-card payment."}'::jsonb, '', false),
  ('t15', '50000000-0000-0000-0000-000000000015', '60000000-0000-0000-0000-000000000015', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-29', 'CHASE CARD PAYMENT', -1200.00, 'Transfer', 'transfer', 'Payment', 'CHASE CARD PAYMENT', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t16', '50000000-0000-0000-0000-000000000016', '60000000-0000-0000-0000-000000000016', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-28', 'Sweetgreen', -17.20, 'Food / Restaurants', 'personal', 'Food / Restaurants', 'Sweetgreen', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t17', '50000000-0000-0000-0000-000000000017', '60000000-0000-0000-0000-000000000017', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-28', 'Spotify', -11.99, 'Software / SaaS', 'personal', 'Software / SaaS', 'Spotify', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t18', '50000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000018', '70000000-0000-0000-0000-000000000018', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-27', 'Cash App - Jordan', -47.50, 'Uncategorized', 'shared', 'Transfer', 'CASH APP JORDAN', 'posted', 0.4500, 'venmo', '{"category":"Food / Restaurants","intent":"shared","confidence":0.70,"reason":"Peer-to-peer payment likely hides the real category."}'::jsonb, '', false),
  ('t19', '50000000-0000-0000-0000-000000000019', '60000000-0000-0000-0000-000000000019', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-26', 'Equinox', -260.00, 'Health / Fitness', 'personal', 'Health', 'Equinox', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t20', '50000000-0000-0000-0000-000000000020', '60000000-0000-0000-0000-000000000020', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-26', 'Amazon', -127.83, 'Shopping', 'personal', 'Shopping', 'Amazon', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t21', '50000000-0000-0000-0000-000000000021', '60000000-0000-0000-0000-000000000021', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-25', 'OpenAI', -20.00, 'Software / AI Tools', 'business', 'Software / AI Tools', 'OpenAI', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t22', '50000000-0000-0000-0000-000000000022', '60000000-0000-0000-0000-000000000022', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-24', 'Sweetgreen', -16.45, 'Food / Restaurants', 'personal', 'Food / Restaurants', 'Sweetgreen', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t23', '50000000-0000-0000-0000-000000000023', '60000000-0000-0000-0000-000000000023', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-24', 'Lyft', -18.70, 'Transport / Rideshare', 'personal', 'Transport / Rideshare', 'Lyft', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t24', '50000000-0000-0000-0000-000000000024', '60000000-0000-0000-0000-000000000024', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-23', 'Notion', -10.00, 'Software / SaaS', 'business', 'Software / SaaS', 'Notion', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t25', '50000000-0000-0000-0000-000000000025', '60000000-0000-0000-0000-000000000025', null, '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-04-22', 'PAYROLL DEPOSIT', 6850.00, 'Income', 'personal', 'Deposit', 'PAYROLL DEPOSIT', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t26', '50000000-0000-0000-0000-000000000026', '60000000-0000-0000-0000-000000000026', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-21', 'Trader Joe''s', -64.22, 'Groceries', 'personal', 'Groceries', 'Trader Joe''s', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t27', '50000000-0000-0000-0000-000000000027', '60000000-0000-0000-0000-000000000027', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-20', 'Figma', -15.00, 'Software / SaaS', 'business', 'Software / SaaS', 'Figma', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t28', '50000000-0000-0000-0000-000000000028', '60000000-0000-0000-0000-000000000028', '70000000-0000-0000-0000-000000000028', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-19', 'Venmo - Chris L.', -121.35, 'Uncategorized', 'shared', 'Transfer', 'VENMO PAYMENT CHRIS L', 'posted', 0.3900, 'venmo', '{"category":"Food / Restaurants","intent":"reimbursable","confidence":0.66,"reason":"Amount resembles a group dinner from past peer-to-peer payments."}'::jsonb, '', false),
  ('t29', '50000000-0000-0000-0000-000000000029', '60000000-0000-0000-0000-000000000029', '70000000-0000-0000-0000-000000000029', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-18', 'United Airlines', -612.80, 'Travel / Flights', 'personal', 'Travel / Flights', 'United Airlines', 'posted', 0.7400, 'large', '{"confidence":0.74,"reason":"Large charge compared with recent personal travel spend."}'::jsonb, '', false),
  ('t30', '50000000-0000-0000-0000-000000000030', '60000000-0000-0000-0000-000000000030', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-17', 'Equinox', -260.00, 'Health / Fitness', 'personal', 'Health / Fitness', 'Equinox', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t31', '50000000-0000-0000-0000-000000000031', '60000000-0000-0000-0000-000000000031', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-16', 'GitHub', -4.00, 'Software / SaaS', 'business', 'Software / SaaS', 'GitHub', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t32', '50000000-0000-0000-0000-000000000032', '60000000-0000-0000-0000-000000000032', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-15', 'Sweetgreen', -18.20, 'Food / Restaurants', 'personal', 'Food / Restaurants', 'Sweetgreen', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t33', '50000000-0000-0000-0000-000000000033', '60000000-0000-0000-0000-000000000033', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-14', 'Anthropic', -20.00, 'Software / AI Tools', 'business', 'Software / AI Tools', 'Anthropic', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t34', '50000000-0000-0000-0000-000000000034', '60000000-0000-0000-0000-000000000034', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-13', 'Brooklyn Bagel', -8.50, 'Food / Restaurants', 'personal', 'Food / Restaurants', 'Brooklyn Bagel', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t35', '50000000-0000-0000-0000-000000000035', '60000000-0000-0000-0000-000000000035', null, '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-04-12', 'NYC Rent', -2400.00, 'Housing', 'personal', 'Housing', 'NYC Rent', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t36', '50000000-0000-0000-0000-000000000036', '60000000-0000-0000-0000-000000000036', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-11', 'CVS Pharmacy', -23.40, 'Health / Pharmacy', 'personal', 'Health / Pharmacy', 'CVS Pharmacy', 'posted', 0.9500, null, '{}'::jsonb, '', false),
  ('t37', '50000000-0000-0000-0000-000000000037', '60000000-0000-0000-0000-000000000037', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-09', 'Cursor', -20.00, 'Software / AI Tools', 'business', 'Software / AI Tools', 'Cursor', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t38', '50000000-0000-0000-0000-000000000038', '60000000-0000-0000-0000-000000000038', null, '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-04-08', 'PAYROLL DEPOSIT', 6850.00, 'Income', 'personal', 'Deposit', 'PAYROLL DEPOSIT', 'posted', 0.9500, null, '{}'::jsonb, '', true),
  ('t39', '50000000-0000-0000-0000-000000000039', '60000000-0000-0000-0000-000000000039', '70000000-0000-0000-0000-000000000039', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-06', 'Substack', -8.00, 'Software / SaaS', 'personal', 'Software / SaaS', 'Substack', 'posted', 0.6500, 'new-recurring', '{"recurring":true,"confidence":0.78,"reason":"Charged 2 months in a row at $8."}'::jsonb, '', true),
  ('t40', '50000000-0000-0000-0000-000000000040', '60000000-0000-0000-0000-000000000040', null, '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '2026-04-04', 'Equinox', -260.00, 'Health / Fitness', 'personal', 'Health / Fitness', 'Equinox', 'posted', 0.9500, null, '{}'::jsonb, '', true);

insert into public.raw_transactions (
  id,
  user_id,
  account_id,
  plaid_item_id,
  plaid_transaction_id,
  date,
  name,
  merchant_name,
  amount,
  status,
  plaid_category,
  raw_payload
)
select
  raw_id,
  '11111111-1111-1111-1111-111111111111',
  account_id,
  plaid_item_id,
  'seed-' || mock_id,
  tx_date,
  plaid_merchant,
  plaid_merchant,
  amount,
  status,
  plaid_category,
  jsonb_build_object(
    'source',
    'ledgerData',
    'mock_id',
    mock_id,
    'clean_merchant',
    merchant
  )
from seed_ledger_transactions
on conflict (user_id, plaid_transaction_id) do nothing;

insert into public.enriched_transactions (
  id,
  user_id,
  raw_transaction_id,
  account_id,
  category_id,
  date,
  merchant_name,
  category_name,
  intent,
  amount,
  status,
  confidence,
  note,
  is_recurring,
  source
)
select
  tx.enriched_id,
  '11111111-1111-1111-1111-111111111111',
  tx.raw_id,
  tx.account_id,
  cat.id,
  tx.tx_date,
  tx.merchant,
  tx.category,
  tx.intent,
  tx.amount,
  tx.status,
  tx.confidence,
  tx.note,
  tx.is_recurring,
  'seed'
from seed_ledger_transactions tx
join public.categories cat
  on cat.user_id = '11111111-1111-1111-1111-111111111111'
  and cat.name = tx.category
on conflict (user_id, raw_transaction_id) do update set
  account_id = excluded.account_id,
  category_id = excluded.category_id,
  date = excluded.date,
  merchant_name = excluded.merchant_name,
  category_name = excluded.category_name,
  intent = excluded.intent,
  amount = excluded.amount,
  status = excluded.status,
  confidence = excluded.confidence,
  note = excluded.note,
  is_recurring = excluded.is_recurring,
  source = excluded.source;

insert into public.review_items (
  id,
  user_id,
  enriched_transaction_id,
  reason,
  status,
  explanation,
  ai_suggestion,
  confidence
)
select
  review_id,
  '11111111-1111-1111-1111-111111111111',
  enriched_id,
  review_reason,
  'open',
  case review_reason
    when 'venmo' then 'Peer-to-peer payment. Ledger needs to know what this was actually for.'
    when 'large' then 'Larger than typical for this category. Confirm the label is right.'
    when 'transfer-pair' then 'Looks like a transfer between your accounts. Exclude from spending?'
    when 'new-recurring' then 'Charged more than once. Should Ledger track it as recurring?'
    else 'The suggestion is low confidence and needs a human check.'
  end,
  ai_suggestion,
  coalesce((ai_suggestion ->> 'confidence')::numeric, confidence)
from seed_ledger_transactions
where review_reason is not null
on conflict (user_id, enriched_transaction_id, reason) do update set
  status = 'open',
  explanation = excluded.explanation,
  ai_suggestion = excluded.ai_suggestion,
  confidence = excluded.confidence,
  resolved_at = null,
  resolution_note = null;

insert into public.transaction_splits (
  id,
  user_id,
  enriched_transaction_id,
  category_id,
  label,
  intent,
  amount,
  notes
)
values
  ('80000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '60000000-0000-0000-0000-000000000028', '40000000-0000-0000-0000-000000000002', 'My share - food', 'personal', 46.35, 'Seeded draft split from the peer-to-peer review workflow.'),
  ('80000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '60000000-0000-0000-0000-000000000028', '40000000-0000-0000-0000-000000000002', 'Covered for friends', 'reimbursable', 75.00, 'Seeded draft reimbursable portion.')
on conflict (id) do update set
  category_id = excluded.category_id,
  label = excluded.label,
  intent = excluded.intent,
  amount = excluded.amount,
  notes = excluded.notes;

insert into public.reimbursement_records (
  id,
  user_id,
  enriched_transaction_id,
  split_id,
  counterparty,
  expected_amount,
  received_amount,
  status,
  due_date,
  notes
)
values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '60000000-0000-0000-0000-000000000028', '80000000-0000-0000-0000-000000000002', 'Chris L.', 75.00, 0.00, 'expected', '2026-05-19', 'Expected reimbursement for the group dinner split.')
on conflict (id) do update set
  split_id = excluded.split_id,
  counterparty = excluded.counterparty,
  expected_amount = excluded.expected_amount,
  received_amount = excluded.received_amount,
  status = excluded.status,
  due_date = excluded.due_date,
  notes = excluded.notes;

insert into public.recurring_expenses (
  id,
  user_id,
  merchant_rule_id,
  category_id,
  account_id,
  last_transaction_id,
  merchant_name,
  amount,
  cadence,
  next_due_date,
  last_charge_date,
  last_amount,
  status,
  is_new,
  confidence
)
values
  ('90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000005', 'Equinox', 260.00, 'monthly', '2026-05-14', '2026-05-04', 260.00, 'active', false, 0.9700),
  ('90000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000002', 'Anthropic', 20.00, 'monthly', '2026-05-14', '2026-05-06', 20.00, 'active', false, 0.9700),
  ('90000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000004', 'Cursor', 20.00, 'monthly', '2026-05-12', '2026-05-05', 20.00, 'active', false, 0.9600),
  ('90000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000011', 'Vercel', 20.00, 'monthly', '2026-05-11', '2026-05-01', 20.00, 'active', false, 0.9500),
  ('90000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000008', 'Linear', 16.00, 'monthly', '2026-05-13', '2026-05-03', 16.00, 'active', false, 0.9500),
  ('90000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000021', 'OpenAI', 20.00, 'monthly', '2026-05-17', '2026-04-25', 20.00, 'active', false, 0.9500),
  ('90000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000017', 'Spotify', 11.99, 'monthly', '2026-05-14', '2026-04-28', 11.99, 'active', false, 0.9500),
  ('90000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000024', 'Notion', 10.00, 'monthly', '2026-05-18', '2026-04-23', 10.00, 'active', false, 0.9500),
  ('90000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000027', 'Figma', 15.00, 'monthly', '2026-05-23', '2026-04-20', 15.00, 'active', false, 0.9500),
  ('90000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000031', 'GitHub', 4.00, 'monthly', '2026-05-26', '2026-04-16', 4.00, 'active', false, 0.9500),
  ('90000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', null, '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000039', 'Substack', 8.00, 'monthly', '2026-06-05', '2026-04-06', 8.00, 'pending', true, 0.7800)
on conflict (user_id, merchant_name, cadence) do update set
  merchant_rule_id = excluded.merchant_rule_id,
  category_id = excluded.category_id,
  account_id = excluded.account_id,
  last_transaction_id = excluded.last_transaction_id,
  amount = excluded.amount,
  next_due_date = excluded.next_due_date,
  last_charge_date = excluded.last_charge_date,
  last_amount = excluded.last_amount,
  status = excluded.status,
  is_new = excluded.is_new,
  confidence = excluded.confidence;

insert into public.insights (
  id,
  user_id,
  insight_key,
  title,
  body,
  tone,
  action_label,
  payload,
  generated_at
)
values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'new-substack-subscription', 'Substack looks like a new subscription', 'Charged $8.00 in April and May. Confirm it as recurring.', 'warn', 'Mark recurring', '{"merchant":"Substack","amount":8}'::jsonb, '2026-05-06 12:00:00-07'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'software-costs-up', 'Software costs are up 18%', 'Anthropic, Cursor, OpenAI, Vercel, Linear, GitHub, Notion, and Figma are clustered in one spend bucket.', 'info', 'See breakdown', '{"category":"Software","delta":18}'::jsonb, '2026-05-06 12:00:00-07'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'p2p-review-count', '4 peer-to-peer payments need explanation', 'Explain the real category before these totals become trusted.', 'warn', 'Resolve', '{"reason":"venmo","count":4}'::jsonb, '2026-05-06 12:00:00-07'),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'food-below-run-rate', 'Food is below the usual run rate', '$214 spent against a $400 typical month.', 'ok', null, '{"category":"Food","spent":214,"typical":400}'::jsonb, '2026-05-06 12:00:00-07')
on conflict (user_id, insight_key) do update set
  title = excluded.title,
  body = excluded.body,
  tone = excluded.tone,
  action_label = excluded.action_label,
  payload = excluded.payload,
  status = 'active',
  generated_at = excluded.generated_at;

insert into public.audit_events (
  id,
  user_id,
  entity_table,
  entity_id,
  action,
  actor_id,
  before_data,
  after_data,
  metadata
)
values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'seed', null, 'ledger_seed_loaded', null, null, '{"accounts":9,"transactions":40,"review_items":8,"recurring_expenses":11}'::jsonb, '{"source":"supabase/seed.sql","base_date":"2026-05-06"}'::jsonb)
on conflict (id) do update set
  after_data = excluded.after_data,
  metadata = excluded.metadata;

commit;
