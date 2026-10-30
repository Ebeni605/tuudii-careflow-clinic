-- Second layer behind RLS: signed-out visitors get no table access at all,
-- and signed-in staff lose privileges no policy ever allows.
REVOKE ALL ON public.appointments, public.audit_log, public.patients, public.profiles,
  public.service_categories, public.user_roles, public.visits FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.patients, public.visits, public.appointments, public.profiles FROM authenticated;
REVOKE UPDATE, TRUNCATE ON public.user_roles FROM authenticated;
