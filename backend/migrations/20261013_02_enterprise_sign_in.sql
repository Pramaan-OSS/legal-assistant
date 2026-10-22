-- Own state and identity binding for organization sign-in.
create table public.organization_sign_in_connections (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id) on delete restrict,
 connection_ref text not null unique
);
create table public.enterprise_sign_in_flows (
 id uuid primary key,
 org_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.organization_sign_in_connections(id) on delete cascade,
 connection_ref text not null,
 state text not null,
 nonce text not null,
 verifier text not null,
 redirect_uri text not null,
 expires_at timestamptz not null,
 consumed boolean not null default false,
 link_user_id uuid references auth.users(id) on delete cascade
);
create table public.enterprise_sign_in_identities (
 connection_id uuid not null references public.organization_sign_in_connections(id) on delete cascade,
 subject_hash text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(connection_id,subject_hash),
 unique(connection_id,user_id)
);
alter table public.organization_sign_in_connections enable row level security;
alter table public.enterprise_sign_in_flows enable row level security;
alter table public.enterprise_sign_in_identities enable row level security;
