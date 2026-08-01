alter table public.atlas_discord_link_codes
add column if not exists discord_profile jsonb not null default '{}'::jsonb;

alter table public.atlas_discord_device_links
add column if not exists discord_profile jsonb not null default '{}'::jsonb;

drop function if exists public.create_atlas_discord_link_code(text, text);

create or replace function public.create_atlas_discord_link_code(
  discord_user_id_input text,
  discord_display_name_input text,
  discord_profile_input jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_code text;
  clean_user_id text := left(trim(coalesce(discord_user_id_input, '')), 32);
  clean_display_name text := left(trim(coalesce(discord_display_name_input, '')), 80);
  clean_profile jsonb := case
    when jsonb_typeof(coalesce(discord_profile_input, '{}'::jsonb)) = 'object'
      then coalesce(discord_profile_input, '{}'::jsonb)
    else '{}'::jsonb
  end;
  attempt integer;
begin
  if clean_user_id = '' or clean_display_name = '' then
    raise exception 'Discord user and display name are required';
  end if;

  delete from public.atlas_discord_link_codes
  where discord_user_id = clean_user_id
     or expires_at <= now();

  for attempt in 1..20 loop
    generated_code := public.random_atlas_code(8);

    begin
      insert into public.atlas_discord_link_codes (
        code,
        discord_user_id,
        discord_display_name,
        discord_profile,
        expires_at
      )
      values (
        generated_code,
        clean_user_id,
        clean_display_name,
        clean_profile,
        now() + interval '10 minutes'
      );

      return generated_code;
    exception
      when unique_violation then
        -- Try another code.
    end;
  end loop;

  raise exception 'Could not generate an Atlas link code';
end;
$$;

create or replace function public.claim_atlas_discord_link(
  link_code text,
  device_token text,
  ranger_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized_code text := upper(regexp_replace(trim(coalesce(link_code, '')), '[^A-Za-z0-9]', '', 'g'));
  clean_ranger_name text := left(trim(regexp_replace(coalesce(ranger_name, ''), '\s+', ' ', 'g')), 40);
  clean_device_token text := trim(coalesce(device_token, ''));
  pending_link public.atlas_discord_link_codes%rowtype;
  linked_device public.atlas_discord_device_links%rowtype;
begin
  if length(clean_device_token) < 32 or length(clean_device_token) > 128 then
    raise exception 'Invalid Atlas device token';
  end if;

  if clean_ranger_name = '' then
    raise exception 'Enter your Ranger name before linking Discord';
  end if;

  select *
  into pending_link
  from public.atlas_discord_link_codes
  where code = normalized_code
    and expires_at > now()
  for update;

  if pending_link.code is null then
    raise exception 'Atlas link code is invalid or expired';
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
    public.atlas_device_token_hash(clean_device_token),
    pending_link.discord_user_id,
    pending_link.discord_display_name,
    clean_ranger_name,
    pending_link.discord_profile,
    now(),
    now()
  )
  on conflict (device_token_hash) do update
    set discord_user_id = excluded.discord_user_id,
        discord_display_name = excluded.discord_display_name,
        ranger_name = excluded.ranger_name,
        discord_profile = excluded.discord_profile,
        linked_at = now(),
        last_seen_at = now()
  returning *
  into linked_device;

  delete from public.atlas_discord_link_codes
  where code = normalized_code;

  return jsonb_build_object(
    'linked', true,
    'discord_display_name', linked_device.discord_display_name,
    'ranger_name', linked_device.ranger_name,
    'profile', linked_device.discord_profile,
    'linked_at', linked_device.linked_at
  );
end;
$$;

create or replace function public.get_atlas_discord_link(device_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_device public.atlas_discord_device_links%rowtype;
begin
  if length(trim(coalesce(device_token, ''))) < 32 then
    return null;
  end if;

  select *
  into linked_device
  from public.atlas_discord_device_links
  where device_token_hash = public.atlas_device_token_hash(trim(device_token))
  limit 1;

  if linked_device.id is null then
    return null;
  end if;

  update public.atlas_discord_device_links
  set last_seen_at = now()
  where id = linked_device.id;

  return jsonb_build_object(
    'linked', true,
    'discord_display_name', linked_device.discord_display_name,
    'ranger_name', linked_device.ranger_name,
    'profile', linked_device.discord_profile,
    'linked_at', linked_device.linked_at
  );
end;
$$;

create or replace function public.update_atlas_discord_profile(
  discord_user_id_input text,
  discord_display_name_input text,
  discord_profile_input jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_user_id text := left(trim(coalesce(discord_user_id_input, '')), 32);
  clean_display_name text := left(trim(coalesce(discord_display_name_input, '')), 80);
  clean_profile jsonb := case
    when jsonb_typeof(coalesce(discord_profile_input, '{}'::jsonb)) = 'object'
      then coalesce(discord_profile_input, '{}'::jsonb)
    else '{}'::jsonb
  end;
  updated_count integer := 0;
begin
  if clean_user_id = '' or clean_display_name = '' then
    raise exception 'Discord user and display name are required';
  end if;

  update public.atlas_discord_device_links
  set discord_display_name = clean_display_name,
      discord_profile = clean_profile
  where discord_user_id = clean_user_id;
  get diagnostics updated_count = row_count;

  update public.atlas_discord_link_codes
  set discord_display_name = clean_display_name,
      discord_profile = clean_profile
  where discord_user_id = clean_user_id
    and expires_at > now();

  return updated_count;
end;
$$;

revoke all on function public.create_atlas_discord_link_code(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.update_atlas_discord_profile(text, text, jsonb) from public, anon, authenticated;

grant execute on function public.create_atlas_discord_link_code(text, text, jsonb) to service_role;
grant execute on function public.update_atlas_discord_profile(text, text, jsonb) to service_role;
