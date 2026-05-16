revoke select (
  location,
  payment_meta,
  pending_transaction_id,
  plaid_transaction_id,
  raw_payload
) on public.raw_transactions from anon, authenticated;

drop policy if exists plaid_items_insert_own on public.plaid_items;
drop policy if exists plaid_items_update_own on public.plaid_items;
drop policy if exists plaid_items_delete_own on public.plaid_items;
revoke insert, update, delete on public.plaid_items from anon, authenticated;

drop policy if exists agent_proposals_insert_own on public.agent_proposals;
drop policy if exists agent_proposals_update_own on public.agent_proposals;
drop policy if exists agent_proposals_delete_own on public.agent_proposals;
revoke insert, update, delete on public.agent_proposals from anon, authenticated;

drop policy if exists audit_events_insert_own on public.audit_events;
revoke insert, update, delete on public.audit_events from anon, authenticated;

notify pgrst, 'reload schema';
