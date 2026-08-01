create or replace function public.get_atlas_awake_ranger_count(device_token_input text default '')
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct lower(trim(position.ranger_name)))::integer
  from public.atlas_live_positions position
  where position.expires_at > now()
    and (
      length(trim(coalesce(device_token_input, ''))) < 32
      or position.device_key <> public.atlas_device_token_hash(trim(device_token_input))
    );
$$;

revoke all on function public.get_atlas_awake_ranger_count(text) from public, anon, authenticated;
grant execute on function public.get_atlas_awake_ranger_count(text) to anon;
