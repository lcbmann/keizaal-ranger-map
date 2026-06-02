create extension if not exists pgcrypto with schema extensions;

create table if not exists public.atlas_shares (
  code text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days')
);

alter table public.atlas_shares enable row level security;

revoke all on table public.atlas_shares from anon, authenticated;

create or replace function public.random_atlas_code(code_length integer default 8)
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(code_length);
  generated text := '';
  byte_index integer;
begin
  for byte_index in 0..code_length - 1 loop
    generated := generated || substr(alphabet, (get_byte(bytes, byte_index) % length(alphabet)) + 1, 1);
  end loop;

  return generated;
end;
$$;

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

      return generated_code;
    exception
      when unique_violation then
        -- Try another code.
    end;
  end loop;

  raise exception 'Could not generate a unique atlas share code';
end;
$$;

create or replace function public.get_atlas_share(share_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select payload
  from public.atlas_shares
  where code = upper(regexp_replace(trim(share_code), '[^A-Za-z0-9]', '', 'g'))
    and expires_at > now()
  limit 1;
$$;

grant usage on schema public to anon;
grant execute on function public.create_atlas_share(jsonb) to anon;
grant execute on function public.get_atlas_share(text) to anon;
