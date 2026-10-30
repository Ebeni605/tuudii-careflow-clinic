REVOKE DELETE, TRUNCATE ON public.lab_specimens FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.lab_specimen_tests FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.lab_result_amendments FROM authenticated;
REVOKE ALL ON public.lab_specimens, public.lab_specimen_tests, public.lab_results, public.lab_result_amendments FROM anon;
