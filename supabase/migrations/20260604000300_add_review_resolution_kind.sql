-- Adds a structured `resolution_kind` to review_items so quality and audit
-- queries can group review outcomes from the row alone instead of sniffing
-- the free-form `resolution_note` copy (see issue #146). Existing audit events
-- remain the authoritative event log; this column complements them.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'review_resolution_kind'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.review_resolution_kind as enum (
      'accepted_ai',
      'accepted_manual',
      'edited',
      'dismissed',
      'auto_resolved'
    );
  end if;
end $$;

alter table public.review_items
  add column if not exists resolution_kind public.review_resolution_kind;

comment on column public.review_items.resolution_kind is
  'Structured outcome for a resolved/dismissed review item. Null while open.';

-- Backfill historical rows from their status and note copy. Order matters:
-- the most specific note patterns are checked first.
update public.review_items
set resolution_kind = case
  when status = 'dismissed' then 'dismissed'::public.review_resolution_kind
  when resolution_note ilike '%auto-applied%'
    or resolution_note ilike '%auto-resolved%' then 'auto_resolved'::public.review_resolution_kind
  when resolution_note ilike '%edit%' then 'edited'::public.review_resolution_kind
  when resolution_note ilike '%peer-to-peer%' then 'accepted_manual'::public.review_resolution_kind
  when resolution_note ilike '%accept%' then 'accepted_ai'::public.review_resolution_kind
  else 'accepted_manual'::public.review_resolution_kind
end
where status <> 'open';

-- Keep resolution_kind in lockstep with status: present once resolved or
-- dismissed, absent while the item is still open.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'review_items_resolution_kind_consistent'
      and conrelid = 'public.review_items'::regclass
  ) then
    alter table public.review_items
      add constraint review_items_resolution_kind_consistent check (
        (status = 'open' and resolution_kind is null)
        or (status <> 'open' and resolution_kind is not null)
      );
  end if;
end $$;
