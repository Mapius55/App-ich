-- Konto löschen mit Wochenrhythmus. Deleting an account (the account function's admin.auth.admin.deleteUser, or a
-- delete in the Supabase dashboard) failed with «permission denied for table series» (42501) while her rhythm still
-- had coming days, and the whole delete rolled back. The cascade from auth.users deletes her entries; a cascade fires
-- their AFTER triggers at the outer level (pg_trigger_depth() = 1), as the role that deleted the user: GoTrue's
-- supabase_auth_admin, which has no rights on public.series. So events_series_skip took each coming day for one she
-- let fall away and tried to note it on the rhythm.
-- Now only her own direct delete of a coming day is a skip marker: a write with her login (role authenticated: the
-- app, and the coach, which writes with her token). A delete by any other role (GoTrue removing the account, the
-- service role, the SQL editor) and the rhythm's own functions (pg_trigger_depth() > 1) mark nothing; the rhythm
-- goes with the account anyway. No function with the service role deletes a rhythm's day (Nolio deletes only its own
-- entries, the account function deletes the rhythms themselves before the user).
-- Replaces only the function of 20261124000000_series.sql (its trigger stays); runs as the caller, search_path
-- pinned. Written to run again without harm.

create or replace function public.events_series_skip() returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and current_user = 'authenticated' and old.series_day is not null and old.starts_at > now() then
    update public.series set skip_days = array_append(skip_days, old.series_day)
    where id = old.series_id and not (old.series_day = any (skip_days));
  end if;
  return null;
end;
$$;
comment on function public.events_series_skip() is
  'A coming day of a weekly rhythm she deleted herself (role authenticated: the app, the coach) becomes a skip marker; a delete by another role (the account''s removal) marks nothing.';
