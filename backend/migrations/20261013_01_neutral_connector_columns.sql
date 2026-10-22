-- Rename legacy connector identifiers while retaining deployed data.
do $$
declare target_table text;
begin
  foreach target_table in array array['user_mcp_connector_tools', 'user_mcp_tool_audit_logs'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and information_schema.columns.table_name = target_table and column_name = 'openai_tool_name') then
      execute format('alter table public.%I rename column openai_tool_name to tool_name_for_model', target_table);
    end if;
  end loop;
end $$;
