insert into public.categories (
  user_id,
  name,
  color,
  icon,
  is_system
)
select distinct
  user_id,
  'Education',
  '#435fb6',
  'graduation-cap',
  true
from public.categories
on conflict (user_id, name) do update set
  color = coalesce(public.categories.color, excluded.color),
  icon = coalesce(public.categories.icon, excluded.icon),
  is_system = public.categories.is_system or excluded.is_system;
