create table if not exists public.guild_atlases (
  code text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

alter table public.guild_atlases enable row level security;

revoke all on table public.guild_atlases from anon, authenticated;

create table if not exists public.guild_atlas_admin (
  id boolean primary key default true,
  passphrase_hash text not null,
  updated_at timestamptz not null default now(),
  constraint guild_atlas_admin_singleton check (id)
);

alter table public.guild_atlas_admin enable row level security;

revoke all on table public.guild_atlas_admin from anon, authenticated;

create or replace function public.normalize_guild_atlas_code(atlas_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(trim(coalesce(atlas_code, '')), '[^A-Za-z0-9_-]', '', 'g'));
$$;

create or replace function public.set_guild_atlas_admin_passphrase(new_passphrase text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(new_passphrase, '')) < 8 then
    raise exception 'Guild Atlas admin passphrase must be at least 8 characters';
  end if;

  insert into public.guild_atlas_admin (id, passphrase_hash, updated_at)
  values (true, extensions.crypt(new_passphrase, extensions.gen_salt('bf', 10)), now())
  on conflict (id) do update
    set passphrase_hash = excluded.passphrase_hash,
        updated_at = now();
end;
$$;

create or replace function public.get_guild_atlas(atlas_code text default 'GUILD')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'code', code,
    'payload', payload,
    'updated_at', updated_at,
    'updated_by', updated_by
  )
  from public.guild_atlases
  where code = public.normalize_guild_atlas_code(atlas_code)
  limit 1;
$$;

create or replace function public.publish_guild_atlas(
  atlas_code text,
  share_payload jsonb,
  admin_passphrase text,
  publisher text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized_code text := public.normalize_guild_atlas_code(atlas_code);
  configured_hash text;
  entry_count integer;
  clean_publisher text := left(trim(coalesce(publisher, '')), 40);
begin
  if normalized_code = '' or length(normalized_code) > 24 then
    raise exception 'Invalid Guild Atlas code';
  end if;

  if share_payload is null or jsonb_typeof(share_payload) <> 'object' then
    raise exception 'Invalid Guild Atlas payload';
  end if;

  if share_payload ->> 'v' is distinct from '2' or jsonb_typeof(share_payload -> 'f') <> 'array' then
    raise exception 'Guild Atlas payload must use compact atlas format v2';
  end if;

  select passphrase_hash
  into configured_hash
  from public.guild_atlas_admin
  where id = true;

  if configured_hash is null then
    raise exception 'Guild Atlas admin passphrase has not been configured';
  end if;

  if extensions.crypt(coalesce(admin_passphrase, ''), configured_hash) <> configured_hash then
    raise exception 'Invalid Guild Atlas admin passphrase';
  end if;

  entry_count := jsonb_array_length(share_payload -> 'f');

  insert into public.guild_atlases (code, payload, updated_at, updated_by)
  values (normalized_code, share_payload, now(), clean_publisher)
  on conflict (code) do update
    set payload = excluded.payload,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return jsonb_build_object(
    'code', normalized_code,
    'entry_count', entry_count,
    'updated_by', clean_publisher,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.set_guild_atlas_admin_passphrase(text) from public, anon, authenticated;
revoke all on function public.normalize_guild_atlas_code(text) from public, anon, authenticated;

grant execute on function public.get_guild_atlas(text) to anon;
grant execute on function public.publish_guild_atlas(text, jsonb, text, text) to anon;
