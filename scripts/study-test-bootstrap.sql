-- Disposable PostgreSQL only. These extension stubs do NOT make HTTP requests.
-- Apply the existing acquire/release limiter functions from their real migration
-- after this bootstrap, then apply the new study migration and its test file.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema private;
create schema vault;
create schema net;
grant usage on schema public to service_role;
create table public.study_control(key text primary key,token_sha256 text,enabled boolean not null default false);
grant select on public.study_control to service_role;
create table vault.decrypted_secrets(name text, decrypted_secret text);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
returns bigint language sql as $$ select 1::bigint; $$;
create table private.scan_network_controls(singleton boolean primary key default true,enabled boolean default true,hash_salt uuid default gen_random_uuid(),max_concurrent integer default 8);
insert into private.scan_network_controls(singleton) values(true);
create table private.scan_target_denylist(domain text primary key);
create table private.organization_scan_cooldowns(org_id uuid,domain_key text,expires_at timestamptz);
create table private.scan_network_windows(domain_key text primary key,window_start timestamptz,starts integer);
create table private.scan_network_leases(token uuid,domain_key text,expires_at timestamptz,primary key(token,domain_key));
