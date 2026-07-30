alter table public.atlas_trailmark_visits
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_left_at timestamptz;

update public.atlas_trailmark_visits
set last_seen_at = coalesce(last_seen_at, last_visited_at)
where last_seen_at is null;

alter table public.atlas_trailmark_visits
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null;

create index if not exists atlas_trailmark_visits_presence_idx
on public.atlas_trailmark_visits(atlas_location_id, last_seen_at desc, last_left_at desc);

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
    last_seen_at,
    last_left_at,
    visit_count
  )
  values (
    clean_location_id,
    visit_key,
    clean_ranger_name,
    linked_device.id,
    visited_at,
    visited_at,
    visited_at,
    null,
    1
  )
  on conflict on constraint atlas_trailmark_visits_pkey do update
    set ranger_name = excluded.ranger_name,
        device_link_id = excluded.device_link_id,
        last_visited_at = excluded.last_visited_at,
        last_seen_at = excluded.last_seen_at,
        last_left_at = null,
        visit_count = public.atlas_trailmark_visits.visit_count + 1;

  if linked_device.id is not null then
    select request.id
    into access_request_id
    from public.atlas_trailmark_access_requests request
    where request.device_link_id = linked_device.id
      and request.atlas_location_id = clean_location_id
      and request.requested_at > now() - interval '30 minutes'
      and request.status in ('pending', 'processing', 'granted')
    order by request.requested_at desc
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

create or replace function public.touch_atlas_trailmark_visit(
  atlas_location_id_input text,
  ranger_name_input text,
  device_token_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_location_id text := left(trim(coalesce(atlas_location_id_input, '')), 100);
  clean_ranger_name text := left(trim(regexp_replace(coalesce(ranger_name_input, ''), '\s+', ' ', 'g')), 40);
  clean_device_token text := trim(coalesce(device_token_input, ''));
  linked_device public.atlas_discord_device_links%rowtype;
  visit_key text;
  seen_at timestamptz := now();
  updated_count integer;
begin
  if clean_location_id = '' or clean_ranger_name = '' then
    return jsonb_build_object('active', false);
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
        last_seen_at = seen_at
    where id = linked_device.id;
  else
    visit_key := 'name:' || public.atlas_device_token_hash(lower(clean_ranger_name));
  end if;

  update public.atlas_trailmark_visits
  set ranger_name = clean_ranger_name,
      device_link_id = linked_device.id,
      last_seen_at = seen_at,
      last_left_at = null
  where atlas_trailmark_visits.atlas_location_id = clean_location_id
    and atlas_trailmark_visits.visitor_key = visit_key;

  get diagnostics updated_count = row_count;
  return jsonb_build_object('active', updated_count > 0, 'seen_at', seen_at);
end;
$$;

create or replace function public.leave_atlas_trailmark_visit(
  atlas_location_id_input text,
  ranger_name_input text,
  device_token_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_location_id text := left(trim(coalesce(atlas_location_id_input, '')), 100);
  clean_ranger_name text := left(trim(regexp_replace(coalesce(ranger_name_input, ''), '\s+', ' ', 'g')), 40);
  clean_device_token text := trim(coalesce(device_token_input, ''));
  linked_device public.atlas_discord_device_links%rowtype;
  visit_key text;
  left_at timestamptz := now();
  updated_count integer;
begin
  if clean_location_id = '' or clean_ranger_name = '' then
    return jsonb_build_object('left', false);
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
  else
    visit_key := 'name:' || public.atlas_device_token_hash(lower(clean_ranger_name));
  end if;

  update public.atlas_trailmark_visits
  set last_left_at = left_at
  where atlas_trailmark_visits.atlas_location_id = clean_location_id
    and atlas_trailmark_visits.visitor_key = visit_key
    and atlas_trailmark_visits.last_seen_at > left_at - interval '3 minutes'
    and (atlas_trailmark_visits.last_left_at is null
      or atlas_trailmark_visits.last_left_at < atlas_trailmark_visits.last_seen_at);

  get diagnostics updated_count = row_count;
  return jsonb_build_object('left', updated_count > 0, 'left_at', left_at);
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
        'last_visited_at', recent.last_visited_at,
        'last_seen_at', recent.last_seen_at,
        'last_left_at', recent.last_left_at,
        'is_active', recent.is_active
      )
      order by recent.is_active desc, coalesce(recent.last_left_at, recent.last_seen_at, recent.last_visited_at) desc
    ),
    '[]'::jsonb
  )
  from (
    select
      ranger_name,
      last_visited_at,
      last_seen_at,
      last_left_at,
      last_seen_at > now() - interval '2 minutes'
        and (last_left_at is null or last_left_at < last_seen_at) as is_active
    from public.atlas_trailmark_visits
    where atlas_trailmark_visits.atlas_location_id = left(trim(coalesce(atlas_location_id_input, '')), 100)
      and last_visited_at > now() - interval '30 days'
    order by is_active desc, coalesce(last_left_at, last_seen_at, last_visited_at) desc
    limit 12
  ) recent;
$$;

revoke all on function public.touch_atlas_trailmark_visit(text, text, text) from public, anon, authenticated;
revoke all on function public.leave_atlas_trailmark_visit(text, text, text) from public, anon, authenticated;

grant execute on function public.record_atlas_trailmark_visit(text, text, text) to anon;
grant execute on function public.touch_atlas_trailmark_visit(text, text, text) to anon;
grant execute on function public.leave_atlas_trailmark_visit(text, text, text) to anon;
grant execute on function public.get_recent_atlas_trailmark_visits(text) to anon;
