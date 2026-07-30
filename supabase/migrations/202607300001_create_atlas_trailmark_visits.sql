create table if not exists public.atlas_discord_link_codes (
  code text primary key,
  discord_user_id text not null,
  discord_display_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

alter table public.atlas_discord_link_codes enable row level security;
revoke all on table public.atlas_discord_link_codes from anon, authenticated;

create table if not exists public.atlas_discord_device_links (
  id uuid primary key default extensions.gen_random_uuid(),
  device_token_hash text unique not null,
  discord_user_id text not null,
  discord_display_name text not null,
  ranger_name text not null,
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.atlas_discord_device_links enable row level security;
revoke all on table public.atlas_discord_device_links from anon, authenticated;

create table if not exists public.atlas_trailmark_visits (
  atlas_location_id text not null,
  visitor_key text not null,
  ranger_name text not null,
  device_link_id uuid references public.atlas_discord_device_links(id) on delete set null,
  first_visited_at timestamptz not null default now(),
  last_visited_at timestamptz not null default now(),
  visit_count integer not null default 1,
  primary key (atlas_location_id, visitor_key)
);

alter table public.atlas_trailmark_visits enable row level security;
revoke all on table public.atlas_trailmark_visits from anon, authenticated;

create index if not exists atlas_trailmark_visits_recent_idx
on public.atlas_trailmark_visits(atlas_location_id, last_visited_at desc);

create table if not exists public.atlas_trailmark_access_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  device_link_id uuid not null references public.atlas_discord_device_links(id) on delete cascade,
  discord_user_id text not null,
  atlas_location_id text not null,
  ranger_name text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'granted', 'failed')),
  claimed_at timestamptz,
  completed_at timestamptz,
  discord_guild_id text,
  discord_channel_id text,
  access_expires_at timestamptz,
  error_message text
);

alter table public.atlas_trailmark_access_requests enable row level security;
revoke all on table public.atlas_trailmark_access_requests from anon, authenticated;

create index if not exists atlas_trailmark_access_requests_queue_idx
on public.atlas_trailmark_access_requests(status, requested_at);

create index if not exists atlas_trailmark_access_requests_device_idx
on public.atlas_trailmark_access_requests(device_link_id, atlas_location_id, requested_at desc);

create or replace function public.atlas_device_token_hash(device_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(device_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.create_atlas_discord_link_code(
  discord_user_id_input text,
  discord_display_name_input text
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
        expires_at
      )
      values (
        generated_code,
        clean_user_id,
        clean_display_name,
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
    linked_at,
    last_seen_at
  )
  values (
    public.atlas_device_token_hash(clean_device_token),
    pending_link.discord_user_id,
    pending_link.discord_display_name,
    clean_ranger_name,
    now(),
    now()
  )
  on conflict (device_token_hash) do update
    set discord_user_id = excluded.discord_user_id,
        discord_display_name = excluded.discord_display_name,
        ranger_name = excluded.ranger_name,
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
    'linked_at', linked_device.linked_at
  );
end;
$$;

create or replace function public.unlink_atlas_discord(device_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_count integer;
begin
  delete from public.atlas_discord_device_links
  where device_token_hash = public.atlas_device_token_hash(trim(coalesce(device_token, '')));

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

create or replace function public.record_atlas_trailmark_visit(
  atlas_location_id text,
  ranger_name text,
  device_token text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_location_id text := left(trim(coalesce(atlas_location_id, '')), 100);
  clean_ranger_name text := left(trim(regexp_replace(coalesce(ranger_name, ''), '\s+', ' ', 'g')), 40);
  clean_device_token text := trim(coalesce(device_token, ''));
  linked_device public.atlas_discord_device_links%rowtype;
  visit_key text;
  access_request_id uuid;
  visited_at timestamptz := now();
begin
  if clean_location_id = '' then
    raise exception 'Trailmark location ID is required';
  end if;

  if clean_ranger_name = '' then
    raise exception 'Enter your Ranger name before recording visits';
  end if;

  if clean_device_token <> '' then
    select *
    into linked_device
    from public.atlas_discord_device_links
    where device_token_hash = public.atlas_device_token_hash(clean_device_token)
    limit 1;
  end if;

  if linked_device.id is not null then
    visit_key := 'device:' || linked_device.id::text;
    update public.atlas_discord_device_links
    set ranger_name = clean_ranger_name,
        last_seen_at = now()
    where id = linked_device.id;
  else
    visit_key := 'name:' || public.atlas_device_token_hash(lower(clean_ranger_name));
  end if;

  insert into public.atlas_trailmark_visits (
    atlas_location_id,
    visitor_key,
    ranger_name,
    device_link_id,
    first_visited_at,
    last_visited_at,
    visit_count
  )
  values (
    clean_location_id,
    visit_key,
    clean_ranger_name,
    linked_device.id,
    visited_at,
    visited_at,
    1
  )
  on conflict (atlas_location_id, visitor_key) do update
    set ranger_name = excluded.ranger_name,
        device_link_id = excluded.device_link_id,
        last_visited_at = excluded.last_visited_at,
        visit_count = public.atlas_trailmark_visits.visit_count + 1;

  if linked_device.id is not null then
    select id
    into access_request_id
    from public.atlas_trailmark_access_requests
    where device_link_id = linked_device.id
      and atlas_trailmark_access_requests.atlas_location_id = clean_location_id
      and requested_at > now() - interval '30 minutes'
      and status in ('pending', 'processing', 'granted')
    order by requested_at desc
    limit 1;

    if access_request_id is null then
      insert into public.atlas_trailmark_access_requests (
        device_link_id,
        discord_user_id,
        atlas_location_id,
        ranger_name
      )
      values (
        linked_device.id,
        linked_device.discord_user_id,
        clean_location_id,
        clean_ranger_name
      )
      returning id into access_request_id;
    end if;
  end if;

  return jsonb_build_object(
    'recorded', true,
    'visited_at', visited_at,
    'discord_linked', linked_device.id is not null,
    'access_request_id', access_request_id
  );
end;
$$;

create or replace function public.get_recent_atlas_trailmark_visits(atlas_location_id_input text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ranger_name', recent.ranger_name,
        'last_visited_at', recent.last_visited_at
      )
      order by recent.last_visited_at desc
    ),
    '[]'::jsonb
  )
  from (
    select ranger_name, last_visited_at
    from public.atlas_trailmark_visits
    where atlas_trailmark_visits.atlas_location_id = left(trim(coalesce(atlas_location_id_input, '')), 100)
      and last_visited_at > now() - interval '30 days'
    order by last_visited_at desc
    limit 12
  ) recent;
$$;

create or replace function public.get_atlas_trailmark_access_request(
  access_request_id uuid,
  device_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  linked_device_id uuid;
  access_request public.atlas_trailmark_access_requests%rowtype;
begin
  select id
  into linked_device_id
  from public.atlas_discord_device_links
  where device_token_hash = public.atlas_device_token_hash(trim(coalesce(device_token, '')))
  limit 1;

  if linked_device_id is null then
    return null;
  end if;

  select *
  into access_request
  from public.atlas_trailmark_access_requests
  where id = access_request_id
    and device_link_id = linked_device_id
  limit 1;

  if access_request.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'status', access_request.status,
    'discord_guild_id', access_request.discord_guild_id,
    'discord_channel_id', access_request.discord_channel_id,
    'access_expires_at', access_request.access_expires_at,
    'error_message', access_request.error_message
  );
end;
$$;

create or replace function public.claim_pending_atlas_trailmark_access_requests(
  request_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_requests jsonb;
begin
  with candidates as (
    select id
    from public.atlas_trailmark_access_requests
    where status = 'pending'
       or (status = 'processing' and claimed_at < now() - interval '2 minutes')
    order by requested_at
    limit greatest(1, least(coalesce(request_limit, 10), 50))
    for update skip locked
  ), claimed as (
    update public.atlas_trailmark_access_requests request
    set status = 'processing',
        claimed_at = now(),
        error_message = null
    from candidates
    where request.id = candidates.id
    returning request.id,
              request.discord_user_id,
              request.atlas_location_id,
              request.ranger_name,
              request.requested_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', claimed.id,
        'discord_user_id', claimed.discord_user_id,
        'atlas_location_id', claimed.atlas_location_id,
        'ranger_name', claimed.ranger_name,
        'requested_at', claimed.requested_at
      )
      order by claimed.requested_at
    ),
    '[]'::jsonb
  )
  into claimed_requests
  from claimed;

  return claimed_requests;
end;
$$;

create or replace function public.complete_atlas_trailmark_access_request(
  access_request_id uuid,
  request_status text,
  request_discord_guild_id text default null,
  request_discord_channel_id text default null,
  request_access_expires_at timestamptz default null,
  request_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if request_status not in ('granted', 'failed') then
    raise exception 'Atlas access request must be granted or failed';
  end if;

  update public.atlas_trailmark_access_requests
  set status = request_status,
      completed_at = now(),
      discord_guild_id = case when request_status = 'granted' then left(trim(coalesce(request_discord_guild_id, '')), 32) else null end,
      discord_channel_id = case when request_status = 'granted' then left(trim(coalesce(request_discord_channel_id, '')), 32) else null end,
      access_expires_at = case when request_status = 'granted' then request_access_expires_at else null end,
      error_message = case when request_status = 'failed' then left(trim(coalesce(request_error_message, '')), 240) else null end
  where id = access_request_id
    and status = 'processing';

  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

revoke all on function public.atlas_device_token_hash(text) from public, anon, authenticated;
revoke all on function public.create_atlas_discord_link_code(text, text) from public, anon, authenticated;
revoke all on function public.claim_pending_atlas_trailmark_access_requests(integer) from public, anon, authenticated;
revoke all on function public.complete_atlas_trailmark_access_request(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.create_atlas_discord_link_code(text, text) to service_role;
grant execute on function public.claim_pending_atlas_trailmark_access_requests(integer) to service_role;
grant execute on function public.complete_atlas_trailmark_access_request(uuid, text, text, text, timestamptz, text) to service_role;

grant execute on function public.claim_atlas_discord_link(text, text, text) to anon;
grant execute on function public.get_atlas_discord_link(text) to anon;
grant execute on function public.unlink_atlas_discord(text) to anon;
grant execute on function public.record_atlas_trailmark_visit(text, text, text) to anon;
grant execute on function public.get_recent_atlas_trailmark_visits(text) to anon;
grant execute on function public.get_atlas_trailmark_access_request(uuid, text) to anon;
