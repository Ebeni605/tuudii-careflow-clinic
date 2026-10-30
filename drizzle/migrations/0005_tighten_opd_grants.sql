REVOKE ALL ON public.consultations, public.diagnoses, public.vital_signs, public.lab_requests, public.lab_request_items,
  public.medication_instructions, public.consultation_amendments, public.diagnosis_catalog FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.consultation_amendments FROM authenticated;
REVOKE UPDATE, TRUNCATE ON public.medication_instructions FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.diagnosis_catalog FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.consultations FROM authenticated;
REVOKE UPDATE, TRUNCATE ON public.diagnoses FROM authenticated;