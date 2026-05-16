revoke select (
  access_token_ciphertext,
  plaid_item_id,
  transaction_cursor
) on public.plaid_items from anon, authenticated;

notify pgrst, 'reload schema';
