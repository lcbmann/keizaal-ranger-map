-- Discord OAuth changes browser requests from the anon role to authenticated.
-- Preserve the existing Atlas RPC surface for signed-in Rangers, then expose a
-- count-only presence summary that Wayfinder can refresh without publishing
-- member identities.

grant execute on function public.create_atlas_share(jsonb) to authenticated;
grant execute on function public.get_atlas_share(text) to authenticated;
grant execute on function public.get_guild_atlas(text) to authenticated;
grant execute on function public.publish_guild_atlas(text, jsonb, text, text) to authenticated;
grant execute on function public.get_all_atlas_entries(text) to authenticated;

grant execute on function public.claim_atlas_discord_link(text, text, text) to authenticated;
grant execute on function public.get_atlas_discord_link(text) to authenticated;
grant execute on function public.unlink_atlas_discord(text) to authenticated;
grant execute on function public.record_atlas_trailmark_visit(text, text, text) to authenticated;
grant execute on function public.touch_atlas_trailmark_visit(text, text, text) to authenticated;
grant execute on function public.leave_atlas_trailmark_visit(text, text, text) to authenticated;
grant execute on function public.get_recent_atlas_trailmark_visits(text) to authenticated;
grant execute on function public.get_atlas_trailmark_access_request(uuid, text) to authenticated;

grant execute on function public.upsert_atlas_live_position(
  text,
  text,
  double precision,
  double precision,
  double precision
) to authenticated;
grant execute on function public.remove_atlas_live_position(text) to authenticated;
grant execute on function public.get_atlas_live_positions(text) to authenticated;
grant execute on function public.submit_atlas_trailmark_drop(text, text, text) to authenticated;
grant execute on function public.get_atlas_trailmark_drop(uuid, text) to authenticated;
grant execute on function public.get_atlas_awake_ranger_count(text) to authenticated;

create table if not exists public.atlas_discord_presence_summary (
  id boolean primary key default true,
  online_count integer not null default 0 check (online_count >= 0),
  playing_skyrim_count integer not null default 0 check (playing_skyrim_count >= 0),
  observed_at timestamptz not null default now(),
  constraint atlas_discord_presence_summary_singleton check (id)
);

alter table public.atlas_discord_presence_summary enable row level security;
revoke all on table public.atlas_discord_presence_summary from anon, authenticated;

create or replace function public.set_atlas_discord_presence_summary(
  online_count_input integer,
  playing_skyrim_count_input integer default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.atlas_discord_presence_summary (
    id,
    online_count,
    playing_skyrim_count,
    observed_at
  )
  values (
    true,
    greatest(0, coalesce(online_count_input, 0)),
    greatest(0, coalesce(playing_skyrim_count_input, 0)),
    now()
  )
  on conflict (id) do update
    set online_count = excluded.online_count,
        playing_skyrim_count = excluded.playing_skyrim_count,
        observed_at = excluded.observed_at;
$$;

create or replace function public.get_atlas_presence_summary(
  device_token_input text default ''
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with live_counts as (
    select
      count(distinct lower(trim(position.ranger_name)))::integer as total_count,
      count(distinct lower(trim(position.ranger_name))) filter (
        where length(trim(coalesce(device_token_input, ''))) < 32
          or position.device_key <> public.atlas_device_token_hash(trim(device_token_input))
      )::integer as other_count
    from public.atlas_live_positions position
    where position.expires_at > now()
  ), discord_presence as (
    select
      case when summary.observed_at > now() - interval '2 minutes'
        then summary.online_count
        else null
      end as online_count,
      case when summary.observed_at > now() - interval '2 minutes'
        then summary.playing_skyrim_count
        else null
      end as playing_skyrim_count,
      summary.observed_at
    from public.atlas_discord_presence_summary summary
    where summary.id = true
  )
  select jsonb_build_object(
    'in_skyrim_count', live_counts.total_count,
    'other_in_skyrim_count', live_counts.other_count,
    'discord_online_count', discord_presence.online_count,
    'discord_playing_skyrim_count', discord_presence.playing_skyrim_count,
    'discord_observed_at', discord_presence.observed_at
  )
  from live_counts
  left join discord_presence on true;
$$;

revoke all on function public.set_atlas_discord_presence_summary(integer, integer)
from public, anon, authenticated;
grant execute on function public.set_atlas_discord_presence_summary(integer, integer)
to service_role;

revoke all on function public.get_atlas_presence_summary(text)
from public, anon, authenticated;
grant execute on function public.get_atlas_presence_summary(text)
to anon, authenticated;
