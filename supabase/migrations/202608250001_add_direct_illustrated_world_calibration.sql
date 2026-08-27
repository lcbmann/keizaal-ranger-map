-- Make the active Marshal survey a direct raw-Skyrim-to-illustrated-artwork
-- calibration. Legacy calibration rows remain readable for old clients, but
-- new direct versions are validated and published under skyrim-illustrated.

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
  if clean_map_id <> 'skyrim-illustrated'
    or clean_transform_kind <> 'affine-idw-world-to-illustrated'
    or jsonb_typeof(coalesce(transform_input, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(control_points_input, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid direct illustrated-map calibration';
  end if;
  if jsonb_typeof(transform_input -> 'cell_size') is distinct from 'number'
    or jsonb_typeof(transform_input -> 'x') is distinct from 'array'
    or jsonb_typeof(transform_input -> 'y') is distinct from 'array'
    or jsonb_array_length(transform_input -> 'x') <> 3
    or jsonb_array_length(transform_input -> 'y') <> 3
    or jsonb_array_length(control_points_input) < 3 then
    raise exception 'Direct illustrated calibration requires three affine coefficients per axis and at least three survey points';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(control_points_input) as control(point)
    where jsonb_typeof(control.point -> 'target') is distinct from 'object'
      or jsonb_typeof(control.point #> '{target,x}') is distinct from 'number'
      or jsonb_typeof(control.point #> '{target,y}') is distinct from 'number'
      or jsonb_typeof(control.point -> 'game_position') is distinct from 'object'
      or jsonb_typeof(control.point #> '{game_position,x}') is distinct from 'number'
      or jsonb_typeof(control.point #> '{game_position,y}') is distinct from 'number'
  ) then
    raise exception 'Every survey point must pair an illustrated target with raw Skyrim coordinates';
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
    transform_input,
    control_points_input,
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

revoke all on function public.publish_atlas_map_calibration(text, text, jsonb, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.publish_atlas_map_calibration(text, text, jsonb, jsonb, text, text)
to anon, authenticated;
