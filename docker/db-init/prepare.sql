-- Compatibility roles shared by the bundled and managed application database.
do $$
declare name text;
begin
  foreach name in array array['postgres','anon','authenticated','service_role','authenticator','supabase_auth_admin'] loop
    if not exists(select 1 from pg_roles where rolname=name) then
      execute format('create role %I nologin',name);
    end if;
  end loop;
  execute format('grant anon, authenticated, service_role to %I', current_user);
end $$;
create schema if not exists auth;
