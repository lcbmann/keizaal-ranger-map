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
  on conflict on constraint atlas_trailmark_visits_pkey do update
    set ranger_name = excluded.ranger_name,
        device_link_id = excluded.device_link_id,
        last_visited_at = excluded.last_visited_at,
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
