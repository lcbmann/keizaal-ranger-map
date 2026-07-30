create table if not exists public.atlas_live_positions (
  device_key text primary key,
  ranger_name text not null,
  atlas_x double precision not null,
  atlas_y double precision not null,
  heading_degrees double precision not null default 0,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds')
);

alter table public.atlas_live_positions enable row level security;
revoke all on table public.atlas_live_positions from anon, authenticated;

create index if not exists atlas_live_positions_expiry_idx
on public.atlas_live_positions(expires_at);

create table if not exists public.atlas_overwatch_admin (
  id boolean primary key default true,
  passphrase_hash text not null,
  updated_at timestamptz not null default now(),
  constraint atlas_overwatch_admin_singleton check (id)
);

alter table public.atlas_overwatch_admin enable row level security;
revoke all on table public.atlas_overwatch_admin from anon, authenticated;

create or replace function public.set_atlas_overwatch_passphrase(new_passphrase text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(new_passphrase, '')) < 12 then
    raise exception 'Overwatch passphrase must be at least 12 characters';
  end if;

  insert into public.atlas_overwatch_admin (id, passphrase_hash, updated_at)
  values (true, extensions.crypt(new_passphrase, extensions.gen_salt('bf', 10)), now())
  on conflict (id) do update
    set passphrase_hash = excluded.passphrase_hash,
        updated_at = now();
end;
$$;

create or replace function public.upsert_atlas_live_position(
  device_token_input text,
  ranger_name_input text,
  atlas_x_input double precision,
  atlas_y_input double precision,
  heading_degrees_input double precision default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_device_token text := trim(coalesce(device_token_input, ''));
  clean_ranger_name text := left(trim(regexp_replace(coalesce(ranger_name_input, ''), '\s+', ' ', 'g')), 40);
  normalized_heading double precision :=
    coalesce(heading_degrees_input, 0) - floor(coalesce(heading_degrees_input, 0) / 360.0) * 360.0;
begin
  if length(clean_device_token) < 32 or length(clean_device_token) > 128 then
    raise exception 'Invalid Atlas device token';
  end if;

  if clean_ranger_name = '' then
    raise exception 'Enter your Ranger name before sharing position';
  end if;

  if atlas_x_input < 0 or atlas_x_input > 8192 or atlas_y_input < 0 or atlas_y_input > 6144 then
    raise exception 'Atlas position is outside the Skyrim map';
  end if;

  insert into public.atlas_live_positions (
    device_key,
    ranger_name,
    atlas_x,
    atlas_y,
    heading_degrees,
    updated_at,
    expires_at
  )
  values (
    public.atlas_device_token_hash(clean_device_token),
    clean_ranger_name,
    atlas_x_input,
    atlas_y_input,
    normalized_heading,
    now(),
    now() + interval '45 seconds'
  )
  on conflict on constraint atlas_live_positions_pkey do update
    set ranger_name = excluded.ranger_name,
        atlas_x = excluded.atlas_x,
        atlas_y = excluded.atlas_y,
        heading_degrees = excluded.heading_degrees,
        updated_at = now(),
        expires_at = now() + interval '45 seconds';

  return jsonb_build_object(
    'shared', true,
    'updated_at', now(),
    'expires_at', now() + interval '45 seconds'
  );
end;
$$;

create or replace function public.remove_atlas_live_position(device_token_input text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_count integer;
begin
  delete from public.atlas_live_positions position
  where position.device_key = public.atlas_device_token_hash(trim(coalesce(device_token_input, '')));

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

create or replace function public.get_atlas_live_positions(overwatch_passphrase text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  configured_hash text;
  positions jsonb;
begin
  select admin.passphrase_hash
  into configured_hash
  from public.atlas_overwatch_admin admin
  where admin.id = true;

  if configured_hash is null then
    raise exception 'Overwatch passphrase has not been configured';
  end if;

  if extensions.crypt(coalesce(overwatch_passphrase, ''), configured_hash) <> configured_hash then
    raise exception 'Invalid Overwatch passphrase';
  end if;

  delete from public.atlas_live_positions position
  where position.expires_at <= now();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ranger_name', position.ranger_name,
        'atlas_x', position.atlas_x,
        'atlas_y', position.atlas_y,
        'heading_degrees', position.heading_degrees,
        'updated_at', position.updated_at
      )
      order by position.ranger_name
    ),
    '[]'::jsonb
  )
  into positions
  from public.atlas_live_positions position
  where position.expires_at > now();

  return positions;
end;
$$;

create table if not exists public.atlas_trailmark_drops (
  id uuid primary key default extensions.gen_random_uuid(),
  device_link_id uuid not null references public.atlas_discord_device_links(id) on delete cascade,
  discord_user_id text not null,
  ranger_name text not null,
  atlas_location_id text not null,
  message text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'posted', 'failed')),
  claimed_at timestamptz,
  completed_at timestamptz,
  discord_channel_id text,
  discord_message_id text,
  error_message text
);

alter table public.atlas_trailmark_drops enable row level security;
revoke all on table public.atlas_trailmark_drops from anon, authenticated;

create index if not exists atlas_trailmark_drops_queue_idx
on public.atlas_trailmark_drops(status, requested_at);

create index if not exists atlas_trailmark_drops_device_idx
on public.atlas_trailmark_drops(device_link_id, requested_at desc);

create or replace function public.submit_atlas_trailmark_drop(
  device_token_input text,
  atlas_location_id_input text,
  message_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_device public.atlas_discord_device_links%rowtype;
  recent_visit_at timestamptz;
  created_drop public.atlas_trailmark_drops%rowtype;
  clean_location_id text := left(trim(coalesce(atlas_location_id_input, '')), 100);
  clean_message text := left(trim(coalesce(message_input, '')), 1800);
begin
  select *
  into linked_device
  from public.atlas_discord_device_links device
  where device.device_token_hash = public.atlas_device_token_hash(trim(coalesce(device_token_input, '')))
  limit 1;

  if linked_device.id is null then
    raise exception 'Link Discord before leaving a Trailmark drop';
  end if;

  if clean_location_id = '' or clean_message = '' then
    raise exception 'Trailmark location and message are required';
  end if;

  select visit.last_visited_at
  into recent_visit_at
  from public.atlas_trailmark_visits visit
  where visit.atlas_location_id = clean_location_id
    and visit.visitor_key = 'device:' || linked_device.id::text
    and visit.last_visited_at > now() - interval '30 minutes'
  limit 1;

  if recent_visit_at is null then
    raise exception 'Reach this Trailmark before leaving a drop';
  end if;

  insert into public.atlas_trailmark_drops (
    device_link_id,
    discord_user_id,
    ranger_name,
    atlas_location_id,
    message
  )
  values (
    linked_device.id,
    linked_device.discord_user_id,
    linked_device.ranger_name,
    clean_location_id,
    clean_message
  )
  returning *
  into created_drop;

  update public.atlas_discord_device_links
  set last_seen_at = now()
  where id = linked_device.id;

  return jsonb_build_object(
    'drop_id', created_drop.id,
    'status', created_drop.status
  );
end;
$$;

create or replace function public.get_atlas_trailmark_drop(
  drop_id_input uuid,
  device_token_input text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  linked_device_id uuid;
  trailmark_drop public.atlas_trailmark_drops%rowtype;
begin
  select device.id
  into linked_device_id
  from public.atlas_discord_device_links device
  where device.device_token_hash = public.atlas_device_token_hash(trim(coalesce(device_token_input, '')))
  limit 1;

  if linked_device_id is null then
    return null;
  end if;

  select *
  into trailmark_drop
  from public.atlas_trailmark_drops candidate
  where candidate.id = drop_id_input
    and candidate.device_link_id = linked_device_id
  limit 1;

  if trailmark_drop.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'status', trailmark_drop.status,
    'discord_channel_id', trailmark_drop.discord_channel_id,
    'discord_message_id', trailmark_drop.discord_message_id,
    'error_message', trailmark_drop.error_message,
    'completed_at', trailmark_drop.completed_at
  );
end;
$$;

create or replace function public.claim_pending_atlas_trailmark_drops(
  request_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_drops jsonb;
begin
  with candidates as (
    select trailmark_drop.id
    from public.atlas_trailmark_drops trailmark_drop
    where trailmark_drop.status = 'pending'
       or (trailmark_drop.status = 'processing' and trailmark_drop.claimed_at < now() - interval '2 minutes')
    order by trailmark_drop.requested_at
    limit greatest(1, least(coalesce(request_limit, 10), 50))
    for update skip locked
  ), claimed as (
    update public.atlas_trailmark_drops trailmark_drop
    set status = 'processing',
        claimed_at = now(),
        error_message = null
    from candidates
    where trailmark_drop.id = candidates.id
    returning trailmark_drop.id,
              trailmark_drop.discord_user_id,
              trailmark_drop.ranger_name,
              trailmark_drop.atlas_location_id,
              trailmark_drop.message,
              trailmark_drop.requested_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', claimed.id,
        'discord_user_id', claimed.discord_user_id,
        'ranger_name', claimed.ranger_name,
        'atlas_location_id', claimed.atlas_location_id,
        'message', claimed.message,
        'requested_at', claimed.requested_at
      )
      order by claimed.requested_at
    ),
    '[]'::jsonb
  )
  into claimed_drops
  from claimed;

  return claimed_drops;
end;
$$;

create or replace function public.complete_atlas_trailmark_drop(
  drop_id_input uuid,
  drop_status_input text,
  discord_channel_id_input text default null,
  discord_message_id_input text default null,
  error_message_input text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if drop_status_input not in ('posted', 'failed') then
    raise exception 'Trailmark drop must be posted or failed';
  end if;

  update public.atlas_trailmark_drops trailmark_drop
  set status = drop_status_input,
      completed_at = now(),
      discord_channel_id = case
        when drop_status_input = 'posted'
        then left(trim(coalesce(discord_channel_id_input, '')), 32)
        else null
      end,
      discord_message_id = case
        when drop_status_input = 'posted'
        then left(trim(coalesce(discord_message_id_input, '')), 32)
        else null
      end,
      error_message = case
        when drop_status_input = 'failed'
        then left(trim(coalesce(error_message_input, '')), 240)
        else null
      end
  where trailmark_drop.id = drop_id_input
    and trailmark_drop.status = 'processing';

  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

revoke all on function public.set_atlas_overwatch_passphrase(text) from public, anon, authenticated;
revoke all on function public.claim_pending_atlas_trailmark_drops(integer) from public, anon, authenticated;
revoke all on function public.complete_atlas_trailmark_drop(uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function public.upsert_atlas_live_position(text, text, double precision, double precision, double precision) to anon;
grant execute on function public.remove_atlas_live_position(text) to anon;
grant execute on function public.get_atlas_live_positions(text) to anon;
grant execute on function public.submit_atlas_trailmark_drop(text, text, text) to anon;
grant execute on function public.get_atlas_trailmark_drop(uuid, text) to anon;

grant execute on function public.claim_pending_atlas_trailmark_drops(integer) to service_role;
grant execute on function public.complete_atlas_trailmark_drop(uuid, text, text, text, text) to service_role;
