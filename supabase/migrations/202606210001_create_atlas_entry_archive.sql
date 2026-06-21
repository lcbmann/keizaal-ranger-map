create table if not exists public.atlas_entry_archive (
  feature_id text primary key,
  feature jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.atlas_entry_archive enable row level security;

revoke all on table public.atlas_entry_archive from anon, authenticated;

create or replace function public.archive_atlas_payload(share_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_feature jsonb;
  archived_feature_id text;
begin
  if share_payload is null
    or jsonb_typeof(share_payload) <> 'object'
    or share_payload ->> 'v' is distinct from '2'
    or jsonb_typeof(share_payload -> 'f') <> 'array' then
    return;
  end if;

  for archived_feature in
    select value
    from jsonb_array_elements(share_payload -> 'f')
  loop
    archived_feature_id := archived_feature ->> 0;
    if coalesce(archived_feature_id, '') = '' then
      continue;
    end if;

    insert into public.atlas_entry_archive (feature_id, feature, first_seen_at, last_seen_at)
    values (archived_feature_id, archived_feature, now(), now())
    on conflict (feature_id) do update
      set feature = excluded.feature,
          last_seen_at = now();
  end loop;
end;
$$;

with retained_versions as (
  select feature, created_at as seen_at
  from public.atlas_shares
  cross join lateral jsonb_array_elements(
    case
      when payload ->> 'v' = '2' and jsonb_typeof(payload -> 'f') = 'array' then payload -> 'f'
      else '[]'::jsonb
    end
  ) as archived(feature)

  union all

  select feature, updated_at as seen_at
  from public.guild_atlases
  cross join lateral jsonb_array_elements(
    case
      when payload ->> 'v' = '2' and jsonb_typeof(payload -> 'f') = 'array' then payload -> 'f'
      else '[]'::jsonb
    end
  ) as archived(feature)
), ranked_versions as (
  select
    feature ->> 0 as feature_id,
    feature,
    min(seen_at) over (partition by feature ->> 0) as first_seen_at,
    max(seen_at) over (partition by feature ->> 0) as last_seen_at,
    row_number() over (partition by feature ->> 0 order by seen_at desc) as version_rank
  from retained_versions
  where coalesce(feature ->> 0, '') <> ''
)
insert into public.atlas_entry_archive (feature_id, feature, first_seen_at, last_seen_at)
select feature_id, feature, first_seen_at, last_seen_at
from ranked_versions
where version_rank = 1
on conflict (feature_id) do update
  set feature = excluded.feature,
      first_seen_at = least(public.atlas_entry_archive.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.atlas_entry_archive.last_seen_at, excluded.last_seen_at);

create or replace function public.create_atlas_share(share_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_code text;
  attempt integer;
begin
  if share_payload is null or jsonb_typeof(share_payload) <> 'object' then
    raise exception 'Invalid atlas share payload';
  end if;

  for attempt in 1..20 loop
    generated_code := public.random_atlas_code(8);

    begin
      insert into public.atlas_shares (code, payload)
      values (generated_code, share_payload);

      perform public.archive_atlas_payload(share_payload);
      return generated_code;
    exception
      when unique_violation then
        -- Try another code.
    end;
  end loop;

  raise exception 'Could not generate a unique atlas share code';
end;
$$;

create or replace function public.publish_guild_atlas(
  atlas_code text,
  share_payload jsonb,
  admin_passphrase text,
  publisher text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized_code text := public.normalize_guild_atlas_code(atlas_code);
  configured_hash text;
  entry_count integer;
  clean_publisher text := left(trim(coalesce(publisher, '')), 40);
begin
  if normalized_code = '' or length(normalized_code) > 24 then
    raise exception 'Invalid Guild Atlas code';
  end if;

  if share_payload is null or jsonb_typeof(share_payload) <> 'object' then
    raise exception 'Invalid Guild Atlas payload';
  end if;

  if share_payload ->> 'v' is distinct from '2' or jsonb_typeof(share_payload -> 'f') <> 'array' then
    raise exception 'Guild Atlas payload must use compact atlas format v2';
  end if;

  select passphrase_hash
  into configured_hash
  from public.guild_atlas_admin
  where id = true;

  if configured_hash is null then
    raise exception 'Guild Atlas admin passphrase has not been configured';
  end if;

  if extensions.crypt(coalesce(admin_passphrase, ''), configured_hash) <> configured_hash then
    raise exception 'Invalid Guild Atlas admin passphrase';
  end if;

  entry_count := jsonb_array_length(share_payload -> 'f');

  insert into public.guild_atlases (code, payload, updated_at, updated_by)
  values (normalized_code, share_payload, now(), clean_publisher)
  on conflict (code) do update
    set payload = excluded.payload,
        updated_at = now(),
        updated_by = excluded.updated_by;

  perform public.archive_atlas_payload(share_payload);

  return jsonb_build_object(
    'code', normalized_code,
    'entry_count', entry_count,
    'updated_by', clean_publisher,
    'updated_at', now()
  );
end;
$$;

create or replace function public.get_all_atlas_entries(admin_passphrase text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  configured_hash text;
  recovered_features jsonb;
begin
  select passphrase_hash
  into configured_hash
  from public.guild_atlas_admin
  where id = true;

  if configured_hash is null then
    raise exception 'Guild Atlas admin passphrase has not been configured';
  end if;

  if extensions.crypt(coalesce(admin_passphrase, ''), configured_hash) <> configured_hash then
    raise exception 'Invalid Guild Atlas admin passphrase';
  end if;

  select coalesce(jsonb_agg(feature order by first_seen_at), '[]'::jsonb)
  into recovered_features
  from public.atlas_entry_archive;

  return jsonb_build_object(
    'v', 2,
    'w', 8192,
    'h', 6144,
    'f', recovered_features
  );
end;
$$;

revoke all on function public.archive_atlas_payload(jsonb) from public, anon, authenticated;
revoke all on function public.get_all_atlas_entries(text) from public, anon, authenticated;

grant execute on function public.get_all_atlas_entries(text) to anon;
