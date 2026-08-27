-- Mandatory City and Town reference layer. Settlements are readable by every
-- Atlas, but only Rangers with the existing Marshal Trailmark permission can
-- create or revise them. They intentionally have no delete/retire RPC.

create table if not exists public.atlas_official_settlements (
  feature_id text primary key,
  feature jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  change_reason text not null default '',
  constraint atlas_official_settlements_compact_marker check (
    jsonb_typeof(feature) = 'array'
    and feature ->> 1 = 'm'
    and (
      public.atlas_compact_feature_has_category(feature, '0')
      or public.atlas_compact_feature_has_category(feature, '1')
    )
    and not public.atlas_compact_feature_has_category(feature, 'c')
  )
);

create table if not exists public.atlas_official_settlement_revisions (
  id bigint generated always as identity primary key,
  feature_id text not null,
  revision bigint not null,
  feature jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by text not null default '',
  change_reason text not null default '',
  unique (feature_id, revision)
);

alter table public.atlas_official_settlements enable row level security;
alter table public.atlas_official_settlement_revisions enable row level security;
revoke all on table public.atlas_official_settlements from anon, authenticated;
revoke all on table public.atlas_official_settlement_revisions from anon, authenticated;

create or replace function public.prepare_atlas_official_settlement_revision()
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

create or replace function public.archive_atlas_official_settlement_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.atlas_official_settlement_revisions (
    feature_id, revision, feature, changed_at, changed_by, change_reason
  ) values (
    new.feature_id, new.revision, new.feature, new.updated_at,
    new.updated_by, new.change_reason
  );
  return new;
end;
$$;

drop trigger if exists prepare_atlas_official_settlement_revision on public.atlas_official_settlements;
create trigger prepare_atlas_official_settlement_revision
before insert or update on public.atlas_official_settlements
for each row execute function public.prepare_atlas_official_settlement_revision();

drop trigger if exists archive_atlas_official_settlement_revision on public.atlas_official_settlements;
create trigger archive_atlas_official_settlement_revision
after insert or update on public.atlas_official_settlements
for each row execute function public.archive_atlas_official_settlement_revision();

-- Promote the printed Atlas reference settlements into the authoritative
-- layer. Existing official revisions win if this migration is reapplied.
insert into public.atlas_official_settlements (
  feature_id, feature, updated_by, change_reason
)
select
  seed.feature_id,
  jsonb_build_array(
    seed.feature_id,
    'm',
    seed.category_code,
    seed.title,
    'c',
    case when seed.category_code = '0'
      then 'Hold capital marked on the official Atlas.'
      else 'Town marked on the official Atlas.'
    end,
    jsonb_build_array(seed.x, seed.y),
    '',
    '',
    'Ranger Corps',
    '',
    '',
    '[]'::jsonb,
    ''
  ),
  'Ranger Corps',
  'Promoted from the printed Atlas reference layer'
from (values
  ('default-dawnstar', 'Dawnstar', '0', 4604, 4871),
  ('default-winterhold', 'Winterhold', '0', 5989, 4794),
  ('default-windhelm', 'Windhelm', '0', 6414, 3707),
  ('default-riften', 'Riften', '0', 7253, 1312),
  ('default-falkreath', 'Falkreath', '0', 3475, 1382),
  ('default-markarth', 'Markarth', '0', 868, 3097),
  ('default-solitude', 'Solitude', '0', 2785, 4907),
  ('default-morthal', 'Morthal', '0', 3349, 4119),
  ('default-whiterun', 'Whiterun', '0', 4452, 2956),
  ('default-dragon-bridge', 'Dragon Bridge', '1', 2095, 4429),
  ('default-karthwasten', 'Karthwasten', '1', 1591, 3625),
  ('default-rorikstead', 'Rorikstead', '1', 2471, 3049),
  ('default-helgen', 'Helgen', '1', 4286, 1532),
  ('default-ivarstead', 'Ivarstead', '1', 5385, 1819),
  ('default-shors-stone', 'Shor''s Stone', '1', 6924, 1827),
  ('default-riverwood', 'Riverwood', '1', 4376, 2119)
) as seed(feature_id, title, category_code, x, y)
on conflict (feature_id) do nothing;

-- Preserve any City or Town entries already carried by the legacy GUILD
-- payload. This is additive: the printed defaults and any existing official
-- revisions remain authoritative when IDs collide.
insert into public.atlas_official_settlements (
  feature_id, feature, updated_by, change_reason
)
select
  trim(feature ->> 0),
  feature,
  left(trim(coalesce(guild.updated_by, '')), 80),
  'Promoted from the legacy GUILD reference layer'
from public.guild_atlases guild
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(guild.payload -> 'f') = 'array' then guild.payload -> 'f'
    else '[]'::jsonb
  end
) feature
where guild.code = 'GUILD'
  and jsonb_typeof(feature) = 'array'
  and feature ->> 1 = 'm'
  and trim(coalesce(feature ->> 0, '')) <> ''
  and (
    public.atlas_compact_feature_has_category(feature, '0')
    or public.atlas_compact_feature_has_category(feature, '1')
  )
  and not public.atlas_compact_feature_has_category(feature, 'c')
on conflict (feature_id) do nothing;

create or replace function public.get_official_atlas_settlements()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'version', 1,
    'revision', coalesce(max(settlement.revision), 0),
    'updated_at', max(settlement.updated_at),
    'payload', jsonb_build_object(
      'v', 2,
      'w', 8192,
      'h', 6144,
      'f', coalesce(
        jsonb_agg(settlement.feature order by settlement.feature ->> 3),
        '[]'::jsonb
      )
    ),
    'metadata', coalesce(
      jsonb_object_agg(
        settlement.feature_id,
        jsonb_build_object(
          'revision', settlement.revision,
          'updated_at', settlement.updated_at,
          'updated_by', settlement.updated_by
        )
      ),
      '{}'::jsonb
    )
  )
  from public.atlas_official_settlements settlement;
$$;

create or replace function public.publish_official_atlas_settlement(
  feature_input jsonb,
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
  actor_name text := '';
  saved public.atlas_official_settlements%rowtype;
begin
  if not public.atlas_authorized('trailmarks.manage', device_token_input) then
    raise exception 'Ranger Marshal permission required';
  end if;
  if clean_feature_id = ''
    or feature_input ->> 1 <> 'm'
    or not (
      public.atlas_compact_feature_has_category(feature_input, '0')
      or public.atlas_compact_feature_has_category(feature_input, '1')
    )
    or public.atlas_compact_feature_has_category(feature_input, 'c') then
    raise exception 'Official settlements must be compact City or Town marker features';
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

  insert into public.atlas_official_settlements (
    feature_id, feature, updated_by, change_reason
  ) values (
    clean_feature_id,
    feature_input,
    left(actor_name, 80),
    clean_reason
  )
  on conflict (feature_id) do update
    set feature = excluded.feature,
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

revoke all on function public.get_official_atlas_settlements() from public, anon, authenticated;
revoke all on function public.publish_official_atlas_settlement(jsonb, text, text) from public, anon, authenticated;

grant execute on function public.get_official_atlas_settlements() to anon, authenticated;
grant execute on function public.publish_official_atlas_settlement(jsonb, text, text) to anon, authenticated;
