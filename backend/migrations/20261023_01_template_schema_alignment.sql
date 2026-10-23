-- Bring upgraded template databases into agreement with fresh installations.
alter table public.google_workspace_oauth_states
  drop constraint if exists google_workspace_oauth_states_provider_check;
alter table public.user_google_workspace_tokens
  drop constraint if exists user_google_workspace_tokens_provider_check;
alter table public.user_api_keys
  drop constraint if exists user_api_keys_provider_check;
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.user_mcp_connector_tools'::regclass
             and conname = 'user_mcp_connector_tools_openai_tool_name_key') then
    alter table public.user_mcp_connector_tools
      rename constraint user_mcp_connector_tools_openai_tool_name_key
      to user_mcp_connector_tools_tool_name_for_model_key;
  end if;
end $$;
