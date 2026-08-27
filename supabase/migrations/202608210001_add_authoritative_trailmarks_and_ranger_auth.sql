-- Ranger production boundary: authoritative Trailmarks, Discord-backed Ranger
-- authorization, and versioned map calibration. This migration is additive so
-- the legacy GUILD payload remains available during rollout.

create table if not exists public.atlas_ranger_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  discord_user_id text not null unique,
  display_name text not null default '',
  active boolean not null default false,
  permissions text[] not null default '{}'::text[],
  roles jsonb not null default '[]'::jsonb,
  discord_profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.atlas_ranger_accounts enable row level security;
revoke all on table public.atlas_ranger_accounts from anon, authenticated;

-- Wayfinder can synchronize Ranger membership before a user has signed in to
-- the Atlas. OAuth registration then attaches that pre-existing membership to
-- the authenticated Supabase user instead of creating an unverified account.
create table if not exists public.atlas_ranger_directory (
  discord_user_id text primary key,
  display_name text not null default '',
  active boolean not null default false,
  permissions text[] not null default '{}'::text[],
  roles jsonb not null default '[]'::jsonb,
  discord_profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.atlas_ranger_directory enable row level security;
revoke all on table public.atlas_ranger_directory from anon, authenticated;

create or replace function public.atlas_profile_has_permission(
  profile_input jsonb,
  permission_input text
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  clean_profile jsonb := case
    when jsonb_typeof(coalesce(profile_input, '{}'::jsonb)) = 'object'
      then coalesce(profile_input, '{}'::jsonb)
    else '{}'::jsonb
  end;
  clean_permission text := lower(trim(coalesce(permission_input, '')));
  profile_role jsonb;
  role_key text;
begin
  if clean_permission = '' then
    return false;
  end if;

  if jsonb_typeof(clean_profile -> 'permissions') = 'array'
    and exists (
      select 1
      from jsonb_array_elements_text(clean_profile -> 'permissions') as allowed(permission)
      where lower(trim(allowed.permission)) = clean_permission
    ) then
    return true;
  end if;

  if clean_permission <> 'trailmarks.manage' then
    return false;
  end if;

  role_key := regexp_replace(lower(coalesce(
    clean_profile -> 'primary_badge' ->> 'id',
    clean_profile ->> 'access_level',
    ''
  )), '[^a-z0-9]+', '', 'g');
  if role_key in ('rangercommander', 'rangercaptain', 'rangermarshal') then
    return true;
  end if;

  if jsonb_typeof(clean_profile -> 'roles') = 'array' then
    for profile_role in select value from jsonb_array_elements(clean_profile -> 'roles') loop
      role_key := regexp_replace(lower(trim(coalesce(
        profile_role ->> 'id',
        profile_role ->> 'slug',
        profile_role ->> 'name',
        trim(both '"' from profile_role::text),
        ''
      ))), '[^a-z0-9]+', '', 'g');
      if role_key in ('rangercommander', 'rangercaptain', 'rangermarshal') then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function public.atlas_current_user_has_permission(permission_input text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.atlas_ranger_accounts account
    join public.atlas_ranger_directory directory
      on directory.discord_user_id = account.discord_user_id
    where account.auth_user_id = auth.uid()
      and directory.active
      and (
        exists (
          select 1
          from unnest(directory.permissions) as permission_value
          where lower(trim(permission_value)) = lower(trim(permission_input))
        )
        or public.atlas_profile_has_permission(directory.discord_profile, permission_input)
      )
  );
$$;

create or replace function public.atlas_device_has_permission(
  device_token_input text,
  permission_input text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.atlas_discord_device_links linked_device
    join public.atlas_ranger_directory directory
      on directory.discord_user_id = linked_device.discord_user_id
    where length(trim(coalesce(device_token_input, ''))) >= 32
      and linked_device.device_token_hash = public.atlas_device_token_hash(trim(device_token_input))
      and directory.active
      and (
        exists (
          select 1
          from unnest(directory.permissions) as permission_value
          where lower(trim(permission_value)) = lower(trim(permission_input))
        )
        or public.atlas_profile_has_permission(directory.discord_profile, permission_input)
      )
  );
$$;

create or replace function public.atlas_authorized(
  permission_input text,
  device_token_input text default ''
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.atlas_current_user_has_permission(permission_input)
    or public.atlas_device_has_permission(device_token_input, permission_input);
$$;

create or replace function public.register_my_atlas_discord_identity()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  identity_provider_id text;
  identity_profile jsonb;
  clean_discord_id text;
  clean_display_name text;
  directory_entry public.atlas_ranger_directory%rowtype;
  account public.atlas_ranger_accounts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Discord sign-in required';
  end if;

  select provider_id, identity_data
  into identity_provider_id, identity_profile
  from auth.identities
  where user_id = current_user_id
    and provider = 'discord'
  order by created_at desc
  limit 1;

  clean_discord_id := left(trim(coalesce(
    identity_provider_id,
    identity_profile ->> 'provider_id',
    identity_profile ->> 'sub',
    identity_profile ->> 'id',
    ''
  )), 32);
  clean_display_name := left(trim(coalesce(
    identity_profile ->> 'full_name',
    identity_profile ->> 'name',
    identity_profile ->> 'preferred_username',
    identity_profile ->> 'user_name',
    ''
  )), 80);

  if clean_discord_id = '' then
    raise exception 'Signed-in account is not a Discord identity';
  end if;

  select * into directory_entry
  from public.atlas_ranger_directory directory
  where directory.discord_user_id = clean_discord_id;

  delete from public.atlas_ranger_accounts existing_account
  where existing_account.auth_user_id = current_user_id
    and existing_account.discord_user_id <> clean_discord_id;

  insert into public.atlas_ranger_accounts (
    auth_user_id,
    discord_user_id,
    display_name,
    active,
    permissions,
    roles,
    discord_profile,
    updated_at
  )
  values (
    current_user_id,
    clean_discord_id,
    coalesce(nullif(directory_entry.display_name, ''), clean_display_name),
    coalesce(directory_entry.active, false),
    coalesce(directory_entry.permissions, '{}'::text[]),
    coalesce(directory_entry.roles, '[]'::jsonb),
    coalesce(directory_entry.discord_profile, '{}'::jsonb),
    now()
  )
  on conflict (discord_user_id) do update
    set auth_user_id = excluded.auth_user_id,
        display_name = coalesce(nullif(excluded.display_name, ''), public.atlas_ranger_accounts.display_name),
        active = excluded.active,
        permissions = excluded.permissions,
        roles = excluded.roles,
        discord_profile = excluded.discord_profile,
        updated_at = now()
  returning * into account;

  return jsonb_build_object(
    'signed_in', true,
    'active', account.active,
    'discord_user_id', account.discord_user_id,
    'display_name', account.display_name,
    'permissions', to_jsonb(account.permissions),
    'roles', account.roles,
    'profile', account.discord_profile,
    'updated_at', account.updated_at
  );
end;
$$;

create or replace function public.get_my_atlas_ranger_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'signed_in', true,
    'active', directory.active,
    'discord_user_id', account.discord_user_id,
    'display_name', coalesce(nullif(directory.display_name, ''), account.display_name),
    'permissions', to_jsonb(directory.permissions),
    'roles', directory.roles,
    'profile', directory.discord_profile,
    'updated_at', directory.updated_at
  )
  from public.atlas_ranger_accounts account
  join public.atlas_ranger_directory directory
    on directory.discord_user_id = account.discord_user_id
  where account.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.set_atlas_ranger_access(
  discord_user_id_input text,
  display_name_input text,
  active_input boolean,
  permissions_input text[] default '{}'::text[],
  roles_input jsonb default '[]'::jsonb,
  discord_profile_input jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
  clean_discord_id text := left(trim(coalesce(discord_user_id_input, '')), 32);
  clean_display_name text := left(trim(coalesce(display_name_input, '')), 80);
  clean_permissions text[] := coalesce(permissions_input, '{}'::text[]);
  clean_roles jsonb := case when jsonb_typeof(coalesce(roles_input, '[]'::jsonb)) = 'array'
    then coalesce(roles_input, '[]'::jsonb) else '[]'::jsonb end;
  clean_profile jsonb := case when jsonb_typeof(coalesce(discord_profile_input, '{}'::jsonb)) = 'object'
    then coalesce(discord_profile_input, '{}'::jsonb) else '{}'::jsonb end;
  linked_profile jsonb;
begin
  if clean_discord_id = '' then
    raise exception 'Discord user is required';
  end if;

  if not coalesce(active_input, false) then
    clean_permissions := '{}'::text[];
    clean_roles := '[]'::jsonb;
  end if;

  linked_profile := jsonb_set(
    jsonb_set(clean_profile, '{permissions}', to_jsonb(clean_permissions), true),
    '{roles}',
    clean_roles,
    true
  );

  insert into public.atlas_ranger_directory (
    discord_user_id, display_name, active, permissions, roles,
    discord_profile, updated_at
  ) values (
    clean_discord_id, clean_display_name, coalesce(active_input, false),
    clean_permissions, clean_roles, linked_profile, now()
  )
  on conflict (discord_user_id) do update
    set display_name = excluded.display_name,
        active = excluded.active,
        permissions = excluded.permissions,
        roles = excluded.roles,
        discord_profile = excluded.discord_profile,
        updated_at = now();

  update public.atlas_ranger_accounts
  set display_name = coalesce(nullif(clean_display_name, ''), display_name),
      active = coalesce(active_input, false),
      permissions = clean_permissions,
      roles = clean_roles,
      discord_profile = linked_profile,
      updated_at = now()
  where discord_user_id = clean_discord_id;
  get diagnostics updated_count = row_count;

  perform public.update_atlas_discord_profile(
    clean_discord_id,
    clean_display_name,
    linked_profile
  );

  return updated_count;
end;
$$;

create or replace function public.link_current_atlas_device(
  device_token_input text,
  ranger_name_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account public.atlas_ranger_accounts%rowtype;
  clean_token text := trim(coalesce(device_token_input, ''));
  clean_ranger_name text := left(trim(regexp_replace(coalesce(ranger_name_input, ''), '\s+', ' ', 'g')), 40);
begin
  if length(clean_token) < 32 or length(clean_token) > 128 then
    raise exception 'Invalid Atlas device token';
  end if;
  if clean_ranger_name = '' then
    raise exception 'Enter your Ranger name before linking Discord';
  end if;

  select * into account
  from public.atlas_ranger_accounts
  where auth_user_id = auth.uid()
    and active;

  if account.auth_user_id is null then
    raise exception 'Active Ranger membership required';
  end if;

  insert into public.atlas_discord_device_links (
    device_token_hash,
    discord_user_id,
    discord_display_name,
    ranger_name,
    discord_profile,
    linked_at,
    last_seen_at
  )
  values (
    public.atlas_device_token_hash(clean_token),
    account.discord_user_id,
    account.display_name,
    clean_ranger_name,
    jsonb_set(
      jsonb_set(account.discord_profile, '{permissions}', to_jsonb(account.permissions), true),
      '{roles}',
      account.roles,
      true
    ),
    now(),
    now()
  )
  on conflict (device_token_hash) do update
    set discord_user_id = excluded.discord_user_id,
        discord_display_name = excluded.discord_display_name,
        ranger_name = excluded.ranger_name,
        discord_profile = excluded.discord_profile,
        linked_at = now(),
        last_seen_at = now();

  return public.get_atlas_discord_link(clean_token);
end;
$$;

create or replace function public.atlas_compact_feature_has_category(
  feature_input jsonb,
  category_code_input text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(feature_input) = 'array'
    and (
      feature_input ->> 2 = category_code_input
      or coalesce(feature_input -> 12, '[]'::jsonb) ? category_code_input
    );
$$;

create table if not exists public.atlas_official_trailmarks (
  feature_id text primary key,
  feature jsonb not null,
  game_position jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  change_reason text not null default '',
  constraint atlas_official_trailmarks_compact_marker check (
    jsonb_typeof(feature) = 'array'
    and feature ->> 1 = 'm'
    and public.atlas_compact_feature_has_category(feature, 'c')
  )
);

create table if not exists public.atlas_official_trailmark_revisions (
  id bigint generated always as identity primary key,
  feature_id text not null,
  revision bigint not null,
  feature jsonb not null,
  game_position jsonb not null default '{}'::jsonb,
  active boolean not null,
  changed_at timestamptz not null default now(),
  changed_by text not null default '',
  change_reason text not null default '',
  unique (feature_id, revision)
);

alter table public.atlas_official_trailmarks enable row level security;
alter table public.atlas_official_trailmark_revisions enable row level security;
revoke all on table public.atlas_official_trailmarks from anon, authenticated;
revoke all on table public.atlas_official_trailmark_revisions from anon, authenticated;

create or replace function public.prepare_atlas_official_trailmark_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.revision := old.revision + 1;
  else
    new.updated_at := coalesce(new.updated_at, now());
    new.revision := greatest(coalesce(new.revision, 1), 1);
  end if;
  return new;
end;
$$;

create or replace function public.archive_atlas_official_trailmark_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.atlas_official_trailmark_revisions (
    feature_id, revision, feature, game_position, active,
    changed_at, changed_by, change_reason
  ) values (
    new.feature_id, new.revision, new.feature, new.game_position, new.active,
    new.updated_at, new.updated_by, new.change_reason
  );
  return new;
end;
$$;

drop trigger if exists prepare_atlas_official_trailmark_revision on public.atlas_official_trailmarks;
create trigger prepare_atlas_official_trailmark_revision
before insert or update on public.atlas_official_trailmarks
for each row execute function public.prepare_atlas_official_trailmark_revision();

drop trigger if exists archive_atlas_official_trailmark_revision on public.atlas_official_trailmarks;
create trigger archive_atlas_official_trailmark_revision
after insert or update on public.atlas_official_trailmarks
for each row execute function public.archive_atlas_official_trailmark_revision();

-- Promote Trailmarks from the current official GUILD payload immediately.
-- These are already maintained entries and become the initial mandatory layer.
insert into public.atlas_official_trailmarks (
  feature_id,
  feature,
  active,
  updated_at,
  updated_by,
  change_reason
)
select
  guild_feature ->> 0,
  guild_feature,
  true,
  guild_atlas.updated_at,
  coalesce(nullif(guild_atlas.updated_by, ''), 'GUILD migration'),
  'Migrated from the current official GUILD Atlas'
from public.guild_atlases guild_atlas
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(guild_atlas.payload -> 'f') = 'array' then guild_atlas.payload -> 'f'
    else '[]'::jsonb
  end
) guild_feature
where guild_atlas.code = 'GUILD'
  and guild_feature ->> 1 = 'm'
  and public.atlas_compact_feature_has_category(guild_feature, 'c')
on conflict (feature_id) do nothing;

-- The share archive also contains personal field copies, so archived
-- Trailmarks that are not in the current GUILD payload start inactive. A
-- Marshal can review and restore the genuine entries lost in an overwrite.
insert into public.atlas_official_trailmarks (
  feature_id,
  feature,
  active,
  updated_at,
  updated_by,
  change_reason
)
select
  archived.feature_id,
  archived.feature,
  false,
  archived.last_seen_at,
  'Archive recovery candidate',
  'Awaiting Marshal review after archive recovery'
from public.atlas_entry_archive archived
where archived.feature ->> 1 = 'm'
  and public.atlas_compact_feature_has_category(archived.feature, 'c')
on conflict (feature_id) do nothing;

create or replace function public.get_official_atlas_trailmarks()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'version', 1,
    'revision', coalesce(max(trailmark.revision), 0),
    'updated_at', max(trailmark.updated_at),
    'payload', jsonb_build_object(
      'v', 2,
      'w', 8192,
      'h', 6144,
      'f', coalesce(
        jsonb_agg(trailmark.feature order by trailmark.feature ->> 3)
          filter (where trailmark.active),
        '[]'::jsonb
      )
    ),
    'metadata', coalesce(
      jsonb_object_agg(
        trailmark.feature_id,
        jsonb_build_object(
          'revision', trailmark.revision,
          'game_position', trailmark.game_position,
          'updated_at', trailmark.updated_at,
          'updated_by', trailmark.updated_by
        )
      ) filter (where trailmark.active),
      '{}'::jsonb
    )
  )
  from public.atlas_official_trailmarks trailmark;
$$;

create or replace function public.publish_official_atlas_trailmark(
  feature_input jsonb,
  game_position_input jsonb default '{}'::jsonb,
  device_token_input text default '',
  reason_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_feature_id text := trim(coalesce(feature_input ->> 0, ''));
  clean_reason text := left(trim(coalesce(reason_input, '')), 240);
  clean_game_position jsonb := case
    when jsonb_typeof(coalesce(game_position_input, '{}'::jsonb)) = 'object'
      then coalesce(game_position_input, '{}'::jsonb)
    else '{}'::jsonb
  end;
  actor_name text := '';
  saved public.atlas_official_trailmarks%rowtype;
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;
  if clean_feature_id = ''
    or feature_input ->> 1 <> 'm'
    or not public.atlas_compact_feature_has_category(feature_input, 'c') then
    raise exception 'Official Trailmarks must be compact marker features with the Trailmark category';
  end if;
  if clean_game_position <> '{}'::jsonb and (
    jsonb_typeof(clean_game_position -> 'x') is distinct from 'number'
    or jsonb_typeof(clean_game_position -> 'y') is distinct from 'number'
    or clean_game_position ->> 'interior' = 'true'
  ) then
    raise exception 'Trailmark game position must be a valid outdoor coordinate';
  end if;

  select coalesce(account.display_name, '') into actor_name
  from public.atlas_ranger_accounts account
  where account.auth_user_id = auth.uid()
  limit 1;
  if actor_name = '' and length(trim(coalesce(device_token_input, ''))) >= 32 then
    select coalesce(linked_device.ranger_name, linked_device.discord_display_name, '') into actor_name
    from public.atlas_discord_device_links linked_device
    where linked_device.device_token_hash = public.atlas_device_token_hash(trim(device_token_input))
    limit 1;
  end if;

  insert into public.atlas_official_trailmarks (
    feature_id, feature, game_position, active, updated_by, change_reason
  ) values (
    clean_feature_id,
    feature_input,
    clean_game_position,
    true,
    left(actor_name, 80),
    clean_reason
  )
  on conflict (feature_id) do update
    set feature = excluded.feature,
        game_position = case
          when excluded.game_position = '{}'::jsonb then public.atlas_official_trailmarks.game_position
          else excluded.game_position
        end,
        active = true,
        updated_by = excluded.updated_by,
        change_reason = excluded.change_reason
  returning * into saved;

  return jsonb_build_object(
    'feature_id', saved.feature_id,
    'revision', saved.revision,
    'updated_at', saved.updated_at,
    'updated_by', saved.updated_by
  );
end;
$$;

create or replace function public.retire_official_atlas_trailmark(
  feature_id_input text,
  device_token_input text default '',
  reason_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text := '';
  saved public.atlas_official_trailmarks%rowtype;
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;

  select coalesce(account.display_name, '') into actor_name
  from public.atlas_ranger_accounts account
  where account.auth_user_id = auth.uid()
  limit 1;
  if actor_name = '' and length(trim(coalesce(device_token_input, ''))) >= 32 then
    select coalesce(linked_device.ranger_name, linked_device.discord_display_name, '') into actor_name
    from public.atlas_discord_device_links linked_device
    where linked_device.device_token_hash = public.atlas_device_token_hash(trim(device_token_input))
    limit 1;
  end if;

  update public.atlas_official_trailmarks
  set active = false,
      updated_by = case when actor_name <> '' then left(actor_name, 80) else updated_by end,
      change_reason = left(trim(coalesce(reason_input, 'Retired by a Ranger Marshal')), 240)
  where feature_id = trim(coalesce(feature_id_input, ''))
  returning * into saved;

  if saved.feature_id is null then
    raise exception 'Official Trailmark not found';
  end if;

  return jsonb_build_object(
    'feature_id', saved.feature_id,
    'revision', saved.revision,
    'active', saved.active,
    'updated_at', saved.updated_at
  );
end;
$$;

create or replace function public.retire_official_atlas_trailmarks(
  feature_ids_input text[],
  device_token_input text default '',
  reason_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_feature_ids text[];
  actor_name text := '';
  requested_count integer := 0;
  updated_count integer := 0;
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;

  select coalesce(array_agg(distinct trim(candidate)), '{}'::text[])
  into clean_feature_ids
  from unnest(coalesce(feature_ids_input, '{}'::text[])) as requested(candidate)
  where trim(coalesce(candidate, '')) <> '';

  requested_count := cardinality(clean_feature_ids);
  if requested_count = 0 then
    raise exception 'Select at least one official Trailmark';
  end if;

  select coalesce(account.display_name, '') into actor_name
  from public.atlas_ranger_accounts account
  where account.auth_user_id = auth.uid()
  limit 1;
  if actor_name = '' and length(trim(coalesce(device_token_input, ''))) >= 32 then
    select coalesce(linked_device.ranger_name, linked_device.discord_display_name, '') into actor_name
    from public.atlas_discord_device_links linked_device
    where linked_device.device_token_hash = public.atlas_device_token_hash(trim(device_token_input))
    limit 1;
  end if;

  update public.atlas_official_trailmarks trailmark
  set active = false,
      updated_by = case when actor_name <> '' then left(actor_name, 80) else trailmark.updated_by end,
      change_reason = left(trim(coalesce(reason_input, 'Retired by a Ranger Marshal')), 240)
  where trailmark.feature_id = any(clean_feature_ids);

  get diagnostics updated_count = row_count;
  if updated_count <> requested_count then
    raise exception 'One or more official Trailmarks could not be found';
  end if;

  return jsonb_build_object(
    'feature_ids', to_jsonb(clean_feature_ids),
    'retired_count', updated_count,
    'updated_by', left(actor_name, 80),
    'updated_at', now()
  );
end;
$$;

create or replace function public.get_official_atlas_trailmark_revisions(
  feature_id_input text,
  device_token_input text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_feature_id text := trim(coalesce(feature_id_input, ''));
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;
  if clean_feature_id = '' then
    raise exception 'Official Trailmark ID is required';
  end if;

  return coalesce((
    select jsonb_build_object(
      'feature_id', clean_feature_id,
      'revisions', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'revision', history.revision,
            'feature', history.feature,
            'game_position', history.game_position,
            'active', history.active,
            'changed_at', history.changed_at,
            'changed_by', history.changed_by,
            'change_reason', history.change_reason
          ) order by history.revision desc
        ),
        '[]'::jsonb
      )
    )
    from public.atlas_official_trailmark_revisions history
    where history.feature_id = clean_feature_id
  ), jsonb_build_object('feature_id', clean_feature_id, 'revisions', '[]'::jsonb));
end;
$$;

create or replace function public.restore_official_atlas_trailmark_revision(
  feature_id_input text,
  revision_input bigint,
  device_token_input text default '',
  reason_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text := '';
  historical public.atlas_official_trailmark_revisions%rowtype;
  restored public.atlas_official_trailmarks%rowtype;
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;

  select * into historical
  from public.atlas_official_trailmark_revisions
  where feature_id = trim(coalesce(feature_id_input, ''))
    and revision = revision_input;

  if historical.id is null then
    raise exception 'Trailmark revision not found';
  end if;

  select coalesce(account.display_name, '') into actor_name
  from public.atlas_ranger_accounts account
  where account.auth_user_id = auth.uid()
  limit 1;
  if actor_name = '' and length(trim(coalesce(device_token_input, ''))) >= 32 then
    select coalesce(linked_device.ranger_name, linked_device.discord_display_name, '') into actor_name
    from public.atlas_discord_device_links linked_device
    where linked_device.device_token_hash = public.atlas_device_token_hash(trim(device_token_input))
    limit 1;
  end if;

  update public.atlas_official_trailmarks
  set feature = historical.feature,
      game_position = historical.game_position,
      active = historical.active,
      updated_by = case when actor_name <> '' then left(actor_name, 80) else updated_by end,
      change_reason = left(trim(coalesce(reason_input, 'Restored revision ' || revision_input)), 240)
  where feature_id = historical.feature_id
  returning * into restored;

  return jsonb_build_object(
    'feature_id', restored.feature_id,
    'revision', restored.revision,
    'active', restored.active,
    'updated_at', restored.updated_at
  );
end;
$$;

create or replace function public.get_official_atlas_trailmark_recovery_candidates(
  device_token_input text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;

  return (
    select jsonb_build_object(
      'version', 1,
      'payload', jsonb_build_object(
        'v', 2,
        'w', 8192,
        'h', 6144,
        'f', coalesce(
          jsonb_agg(candidate.feature order by candidate.updated_at desc, candidate.feature_id),
          '[]'::jsonb
        )
      ),
      'metadata', coalesce(
        jsonb_object_agg(
          candidate.feature_id,
          jsonb_build_object(
            'revision', candidate.revision,
            'game_position', candidate.game_position,
            'archived_at', candidate.updated_at,
            'change_reason', candidate.change_reason
          )
        ),
        '{}'::jsonb
      )
    )
    from public.atlas_official_trailmarks candidate
    where not candidate.active
      and candidate.updated_by = 'Archive recovery candidate'
  );
end;
$$;

create or replace function public.activate_official_atlas_trailmarks(
  feature_ids_input text[],
  device_token_input text default '',
  reason_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_feature_ids text[];
  actor_name text := '';
  requested_count integer := 0;
  updated_count integer := 0;
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;

  select coalesce(array_agg(distinct trim(candidate)), '{}'::text[])
  into clean_feature_ids
  from unnest(coalesce(feature_ids_input, '{}'::text[])) as requested(candidate)
  where trim(coalesce(candidate, '')) <> '';

  requested_count := cardinality(clean_feature_ids);
  if requested_count = 0 then
    raise exception 'Select at least one archived Trailmark';
  end if;

  select coalesce(account.display_name, '') into actor_name
  from public.atlas_ranger_accounts account
  where account.auth_user_id = auth.uid()
  limit 1;
  if actor_name = '' and length(trim(coalesce(device_token_input, ''))) >= 32 then
    select coalesce(linked_device.ranger_name, linked_device.discord_display_name, '') into actor_name
    from public.atlas_discord_device_links linked_device
    where linked_device.device_token_hash = public.atlas_device_token_hash(trim(device_token_input))
    limit 1;
  end if;

  update public.atlas_official_trailmarks candidate
  set active = true,
      updated_by = case when actor_name <> '' then left(actor_name, 80) else 'Ranger Marshal' end,
      change_reason = left(trim(coalesce(
        nullif(reason_input, ''),
        'Restored after Marshal archive review'
      )), 240)
  where candidate.feature_id = any(clean_feature_ids)
    and not candidate.active
    and candidate.updated_by = 'Archive recovery candidate';

  get diagnostics updated_count = row_count;
  if updated_count <> requested_count then
    raise exception 'One or more selected entries are not available recovery candidates';
  end if;

  return jsonb_build_object(
    'feature_ids', to_jsonb(clean_feature_ids),
    'restored_count', updated_count,
    'updated_by', left(actor_name, 80),
    'updated_at', now()
  );
end;
$$;

create table if not exists public.atlas_map_calibrations (
  map_id text not null,
  version bigint not null,
  active boolean not null default false,
  transform_kind text not null,
  transform jsonb not null default '{}'::jsonb,
  control_points jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  notes text not null default '',
  primary key (map_id, version),
  constraint atlas_map_calibrations_map_id check (map_id ~ '^[a-z0-9_-]{2,40}$'),
  constraint atlas_map_calibrations_transform_object check (jsonb_typeof(transform) = 'object'),
  constraint atlas_map_calibrations_controls_array check (jsonb_typeof(control_points) = 'array')
);

create unique index if not exists atlas_map_calibrations_one_active
on public.atlas_map_calibrations (map_id)
where active;

alter table public.atlas_map_calibrations enable row level security;
revoke all on table public.atlas_map_calibrations from anon, authenticated;

insert into public.atlas_map_calibrations (
  map_id, version, active, transform_kind, transform, control_points, updated_by, notes
)
values (
  'skyrim-world',
  1,
  true,
  'affine-cell-to-canonical',
  '{"cell_size":4096,"x":[73.826813,0.215295427,4067.73578],"y":[-0.324059025,74.56657,3036.85421],"offset":{"x":-128,"y":0}}'::jsonb,
  '[]'::jsonb,
  'Migration',
  'Current Ranger Atlas game-to-parchment calibration'
), (
  'illustrated',
  1,
  true,
  'inverse-distance-canonical-to-artwork',
  '{}'::jsonb,
  '[
    {"id":"default-dawnstar","x":4349,"y":4936},
    {"id":"default-winterhold","x":6121,"y":5109},
    {"id":"default-windhelm","x":6231,"y":3785},
    {"id":"default-riften","x":7272,"y":1071},
    {"id":"default-falkreath","x":3326,"y":1217},
    {"id":"default-markarth","x":786,"y":2935},
    {"id":"default-solitude","x":2604,"y":5201},
    {"id":"default-morthal","x":3252,"y":4141},
    {"id":"default-whiterun","x":4321,"y":2825},
    {"id":"default-dragon-bridge","x":1946,"y":4643},
    {"id":"default-karthwasten","x":1498,"y":3711},
    {"id":"default-rorikstead","x":2448,"y":2981},
    {"id":"default-helgen","x":4221,"y":1400},
    {"id":"default-ivarstead","x":5317,"y":1820},
    {"id":"default-shors-stone","x":6752,"y":2040},
    {"id":"default-riverwood","x":4303,"y":1957}
  ]'::jsonb,
  'Migration',
  'Marshal-calibrated illustrated map reference points'
)
on conflict (map_id, version) do nothing;

create or replace function public.get_active_atlas_map_calibrations()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'map_id', calibration.map_id,
        'version', calibration.version,
        'transform_kind', calibration.transform_kind,
        'transform', calibration.transform,
        'control_points', calibration.control_points,
        'updated_at', calibration.updated_at,
        'updated_by', calibration.updated_by,
        'notes', calibration.notes
      ) order by calibration.map_id
    ),
    '[]'::jsonb
  )
  from public.atlas_map_calibrations calibration
  where calibration.active;
$$;

create or replace function public.publish_atlas_map_calibration(
  map_id_input text,
  transform_kind_input text,
  transform_input jsonb,
  control_points_input jsonb,
  device_token_input text default '',
  notes_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_map_id text := lower(trim(coalesce(map_id_input, '')));
  clean_transform_kind text := left(trim(coalesce(transform_kind_input, '')), 80);
  next_version bigint;
  actor_name text := '';
  saved public.atlas_map_calibrations%rowtype;
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;
  if clean_map_id not in ('skyrim-world', 'illustrated')
    or jsonb_typeof(coalesce(transform_input, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(control_points_input, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid Atlas calibration';
  end if;
  if (clean_map_id = 'skyrim-world' and clean_transform_kind <> 'affine-cell-to-canonical')
    or (clean_map_id = 'illustrated' and clean_transform_kind <> 'inverse-distance-canonical-to-artwork') then
    raise exception 'Unsupported Atlas calibration transform';
  end if;
  if clean_map_id = 'skyrim-world' and (
    jsonb_typeof(transform_input -> 'cell_size') is distinct from 'number'
    or jsonb_typeof(transform_input -> 'x') is distinct from 'array'
    or jsonb_typeof(transform_input -> 'y') is distinct from 'array'
    or jsonb_typeof(transform_input -> 'offset') is distinct from 'object'
    or jsonb_typeof(transform_input #> '{offset,x}') is distinct from 'number'
    or jsonb_typeof(transform_input #> '{offset,y}') is distinct from 'number'
  ) then
    raise exception 'Invalid Skyrim coordinate calibration';
  end if;
  if clean_map_id = 'skyrim-world' and (
    jsonb_array_length(transform_input -> 'x') <> 3
    or jsonb_array_length(transform_input -> 'y') <> 3
  ) then
    raise exception 'Skyrim coordinate calibration requires three coefficients per axis';
  end if;
  if clean_map_id = 'illustrated' and jsonb_array_length(control_points_input) < 3 then
    raise exception 'Illustrated calibration requires at least three control points';
  end if;

  perform pg_advisory_xact_lock(hashtext('atlas-map-calibration:' || clean_map_id));

  select coalesce(account.display_name, '') into actor_name
  from public.atlas_ranger_accounts account
  where account.auth_user_id = auth.uid()
  limit 1;
  if actor_name = '' and length(trim(coalesce(device_token_input, ''))) >= 32 then
    select coalesce(linked_device.ranger_name, linked_device.discord_display_name, '') into actor_name
    from public.atlas_discord_device_links linked_device
    where linked_device.device_token_hash = public.atlas_device_token_hash(trim(device_token_input))
    limit 1;
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.atlas_map_calibrations
  where map_id = clean_map_id;

  update public.atlas_map_calibrations
  set active = false
  where map_id = clean_map_id and active;

  insert into public.atlas_map_calibrations (
    map_id, version, active, transform_kind, transform,
    control_points, updated_by, notes
  ) values (
    clean_map_id,
    next_version,
    true,
    clean_transform_kind,
    coalesce(transform_input, '{}'::jsonb),
    coalesce(control_points_input, '[]'::jsonb),
    left(actor_name, 80),
    left(trim(coalesce(notes_input, '')), 500)
  ) returning * into saved;

  return jsonb_build_object(
    'map_id', saved.map_id,
    'version', saved.version,
    'updated_at', saved.updated_at
  );
end;
$$;

revoke all on function public.atlas_profile_has_permission(jsonb, text) from public, anon, authenticated;
revoke all on function public.atlas_current_user_has_permission(text) from public, anon, authenticated;
revoke all on function public.atlas_device_has_permission(text, text) from public, anon, authenticated;
revoke all on function public.atlas_authorized(text, text) from public, anon, authenticated;
revoke all on function public.atlas_compact_feature_has_category(jsonb, text) from public, anon, authenticated;
revoke all on function public.prepare_atlas_official_trailmark_revision() from public, anon, authenticated;
revoke all on function public.archive_atlas_official_trailmark_revision() from public, anon, authenticated;
revoke all on function public.set_atlas_ranger_access(text, text, boolean, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.register_my_atlas_discord_identity() from public, anon, authenticated;
revoke all on function public.get_my_atlas_ranger_access() from public, anon, authenticated;
revoke all on function public.link_current_atlas_device(text, text) from public, anon, authenticated;
revoke all on function public.get_official_atlas_trailmarks() from public, anon, authenticated;
revoke all on function public.publish_official_atlas_trailmark(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.retire_official_atlas_trailmark(text, text, text) from public, anon, authenticated;
revoke all on function public.retire_official_atlas_trailmarks(text[], text, text) from public, anon, authenticated;
revoke all on function public.get_official_atlas_trailmark_revisions(text, text) from public, anon, authenticated;
revoke all on function public.restore_official_atlas_trailmark_revision(text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.get_official_atlas_trailmark_recovery_candidates(text) from public, anon, authenticated;
revoke all on function public.activate_official_atlas_trailmarks(text[], text, text) from public, anon, authenticated;
revoke all on function public.get_active_atlas_map_calibrations() from public, anon, authenticated;
revoke all on function public.publish_atlas_map_calibration(text, text, jsonb, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.register_my_atlas_discord_identity() to authenticated;
grant execute on function public.get_my_atlas_ranger_access() to authenticated;
grant execute on function public.link_current_atlas_device(text, text) to authenticated;
grant execute on function public.set_atlas_ranger_access(text, text, boolean, text[], jsonb, jsonb) to service_role;

grant execute on function public.get_official_atlas_trailmarks() to anon, authenticated;
grant execute on function public.publish_official_atlas_trailmark(jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.retire_official_atlas_trailmark(text, text, text) to anon, authenticated;
grant execute on function public.retire_official_atlas_trailmarks(text[], text, text) to anon, authenticated;
grant execute on function public.get_official_atlas_trailmark_revisions(text, text) to anon, authenticated;
grant execute on function public.restore_official_atlas_trailmark_revision(text, bigint, text, text) to anon, authenticated;
grant execute on function public.get_official_atlas_trailmark_recovery_candidates(text) to anon, authenticated;
grant execute on function public.activate_official_atlas_trailmarks(text[], text, text) to anon, authenticated;

grant execute on function public.get_active_atlas_map_calibrations() to anon, authenticated;
grant execute on function public.publish_atlas_map_calibration(text, text, jsonb, jsonb, text, text) to anon, authenticated;
