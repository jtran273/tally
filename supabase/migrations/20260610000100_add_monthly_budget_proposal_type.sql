alter type public.agent_proposal_type add value if not exists 'monthly_budget_proposal';

notify pgrst, 'reload schema';
