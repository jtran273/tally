alter table public.plaid_items
  add column if not exists connection_source text not null default 'plaid';

alter table public.plaid_items
  drop constraint if exists plaid_items_connection_source_valid;

alter table public.plaid_items
  add constraint plaid_items_connection_source_valid
  check (connection_source in ('plaid', 'manual'));

update public.plaid_items item
set
  auto_sync_enabled = false,
  connection_source = 'manual',
  error_code = null,
  error_message = null,
  status = 'active'
from public.institutions institution
where item.institution_id = institution.id
  and item.user_id = institution.user_id
  and institution.name ilike '%(manual)%';
