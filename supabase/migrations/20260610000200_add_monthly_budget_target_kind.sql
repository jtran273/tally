alter type public.agent_target_kind add value if not exists 'monthly_budget';

notify pgrst, 'reload schema';
