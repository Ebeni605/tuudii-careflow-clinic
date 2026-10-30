CREATE OR REPLACE FUNCTION public.update_my_profile(_full_name text, _phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _full_name IS NULL OR length(btrim(_full_name)) = 0 OR length(_full_name) > 120 THEN
    RAISE EXCEPTION 'Full name is required (max 120 characters)';
  END IF;
  IF _phone IS NOT NULL AND length(_phone) > 20 THEN
    RAISE EXCEPTION 'Phone number is too long';
  END IF;
  -- Only name and phone; active / self-verify flags stay admin-controlled
  UPDATE public.profiles SET full_name = btrim(_full_name), phone = NULLIF(btrim(COALESCE(_phone,'')), '')
  WHERE id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.update_my_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated;

CREATE TRIGGER profiles_audit AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER user_roles_audit AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();