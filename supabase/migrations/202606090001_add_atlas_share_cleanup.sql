create or replace function public.delete_expired_atlas_shares()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.atlas_shares
  where expires_at <= now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_atlas_shares() from public, anon, authenticated;
grant execute on function public.delete_expired_atlas_shares() to service_role;
