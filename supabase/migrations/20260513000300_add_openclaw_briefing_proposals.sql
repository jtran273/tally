alter type public.agent_proposal_type add value if not exists 'openclaw_briefing';
alter type public.agent_target_kind add value if not exists 'openclaw_briefing';

create unique index if not exists agent_proposals_user_source_context_unique_idx
  on public.agent_proposals (user_id, source_agent, source_context_id);

notify pgrst, 'reload schema';
