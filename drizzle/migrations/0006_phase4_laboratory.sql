-- ===================== PHASE 4: LABORATORY =====================

-- ---------- Test catalogue: result types, allowed answers, reference provenance ----------
ALTER TABLE public.lab_tests DROP CONSTRAINT lab_tests_result_type_check;
ALTER TABLE public.lab_tests ADD CONSTRAINT lab_tests_result_type_check
  CHECK (result_type IN ('numeric','qualitative','text','microscopy'));
ALTER TABLE public.lab_tests
  ADD COLUMN result_options text[],
  ADD COLUMN abnormal_options text[],
  ADD COLUMN reference_source text,
  ADD COLUMN catalogue_note text,
  ADD COLUMN reference_updated_by uuid,
  ADD COLUMN reference_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.lab_test_before()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.code := upper(btrim(COALESCE(NEW.code,'')));
  NEW.name := btrim(COALESCE(NEW.name,''));
  NEW.section := btrim(COALESCE(NEW.section,''));
  IF NEW.code = '' OR NEW.name = '' OR NEW.section = '' THEN RAISE EXCEPTION 'Code, test name and category are required'; END IF;
  IF NEW.result_type <> 'numeric' THEN NEW.ref_low := NULL; NEW.ref_high := NULL; END IF;
  IF NEW.ref_low IS NOT NULL AND NEW.ref_high IS NOT NULL AND NEW.ref_low > NEW.ref_high THEN
    RAISE EXCEPTION 'The low reference limit must not be above the high limit';
  END IF;
  IF NEW.result_type = 'qualitative' THEN
    IF COALESCE(cardinality(NEW.result_options),0) = 0 THEN RAISE EXCEPTION 'List the allowed answers for a qualitative test'; END IF;
    IF NEW.abnormal_options IS NOT NULL AND NOT (NEW.abnormal_options <@ NEW.result_options) THEN
      RAISE EXCEPTION 'Abnormal answers must be among the allowed answers';
    END IF;
  ELSE
    NEW.result_options := NULL; NEW.abnormal_options := NULL;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.unit IS DISTINCT FROM OLD.unit OR NEW.ref_low IS DISTINCT FROM OLD.ref_low
     OR NEW.ref_high IS DISTINCT FROM OLD.ref_high OR NEW.ref_text IS DISTINCT FROM OLD.ref_text
     OR NEW.reference_source IS DISTINCT FROM OLD.reference_source OR NEW.abnormal_options IS DISTINCT FROM OLD.abnormal_options THEN
    NEW.reference_updated_by := auth.uid(); NEW.reference_updated_at := now();
  ELSE
    NEW.reference_updated_by := OLD.reference_updated_by; NEW.reference_updated_at := OLD.reference_updated_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_test_before BEFORE INSERT OR UPDATE ON public.lab_tests FOR EACH ROW EXECUTE FUNCTION public.lab_test_before();
REVOKE DELETE, TRUNCATE ON public.lab_tests FROM authenticated;
REVOKE ALL ON public.lab_tests FROM anon;

-- ---------- Explicit verification permission (set by admin only; profiles UPDATE is admin-only) ----------
ALTER TABLE public.profiles ADD COLUMN can_verify_lab boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_verify_lab(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'lab_tech')
     AND COALESCE((SELECT can_verify_lab FROM public.profiles WHERE id = _user_id), false)
$$;
REVOKE ALL ON FUNCTION public.can_verify_lab(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_verify_lab(uuid) TO authenticated, service_role;

-- ---------- Specimens ----------
CREATE SEQUENCE public.lab_specimen_seq;
CREATE TABLE public.lab_specimens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accession_number text UNIQUE,
  lab_request_id uuid NOT NULL REFERENCES public.lab_requests(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  specimen_type text NOT NULL,
  status text NOT NULL DEFAULT 'collected' CHECK (status IN ('collected','received','rejected')),
  collected_by uuid REFERENCES public.profiles(id),
  collected_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid,
  received_at timestamptz,
  condition text,
  notes text,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  replaces_specimen_id uuid REFERENCES public.lab_specimens(id),
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_specimens_request_idx ON public.lab_specimens(lab_request_id);
CREATE INDEX lab_specimens_patient_idx ON public.lab_specimens(patient_id);
GRANT SELECT, INSERT, UPDATE ON public.lab_specimens TO authenticated;
GRANT ALL ON public.lab_specimens TO service_role;
GRANT USAGE ON SEQUENCE public.lab_specimen_seq TO authenticated, service_role;
REVOKE ALL ON public.lab_specimens FROM anon;
ALTER TABLE public.lab_specimens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab clinical read specimens" ON public.lab_specimens FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician','lab_tech']::public.app_role[]));
CREATE POLICY "lab insert specimens" ON public.lab_specimens FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'lab_tech'));
CREATE POLICY "lab update specimens" ON public.lab_specimens FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'lab_tech')) WITH CHECK (public.has_role(auth.uid(),'lab_tech'));

CREATE OR REPLACE FUNCTION public.lab_specimen_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; prev record; in_status text; in_reason text; in_condition text; in_notes text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Specimen records cannot be deleted'; END IF;
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'lab_tech') THEN
    RAISE EXCEPTION 'Only laboratory staff can record specimens';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO r FROM public.lab_requests WHERE id = NEW.lab_request_id;
    IF r IS NULL THEN RAISE EXCEPTION 'Laboratory request not found'; END IF;
    IF r.status = 'cancelled' THEN RAISE EXCEPTION 'This request was cancelled'; END IF;
    NEW.patient_id := r.patient_id;
    NEW.specimen_type := btrim(COALESCE(NEW.specimen_type,''));
    IF NEW.specimen_type = '' THEN RAISE EXCEPTION 'Record the specimen type'; END IF;
    NEW.collected_by := COALESCE(NEW.collected_by, auth.uid());
    IF NOT public.is_staff(NEW.collected_by) THEN RAISE EXCEPTION 'The collecting staff member must be an active staff account'; END IF;
    NEW.collected_at := COALESCE(NEW.collected_at, now());
    IF NEW.collected_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'Collection time cannot be in the future'; END IF;
    IF NEW.collected_at < r.created_at - interval '12 hours' THEN RAISE EXCEPTION 'Collection time is long before the request was made'; END IF;
    IF NEW.replaces_specimen_id IS NOT NULL THEN
      SELECT * INTO prev FROM public.lab_specimens WHERE id = NEW.replaces_specimen_id;
      IF prev IS NULL OR prev.lab_request_id <> NEW.lab_request_id OR prev.status <> 'rejected' THEN
        RAISE EXCEPTION 'A recollection must replace a rejected specimen of the same request';
      END IF;
    END IF;
    NEW.accession_number := 'SP-' || to_char(now() AT TIME ZONE 'Africa/Addis_Ababa','YYMMDD') || '-' || lpad(nextval('public.lab_specimen_seq')::text, 5, '0');
    NEW.status := 'collected';
    NEW.received_by := NULL; NEW.received_at := NULL; NEW.condition := NULL;
    NEW.rejected_by := NULL; NEW.rejected_at := NULL; NEW.rejection_reason := NULL;
    NEW.notes := NULLIF(btrim(COALESCE(NEW.notes,'')), '');
    NEW.recorded_by := auth.uid(); NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status = 'rejected' THEN RAISE EXCEPTION 'A rejected specimen cannot be changed; collect a new one'; END IF;
  in_status := NEW.status; in_reason := NEW.rejection_reason; in_condition := NEW.condition; in_notes := NEW.notes;
  NEW := OLD;
  NEW.notes := NULLIF(btrim(COALESCE(in_notes,'')), '');
  IF in_status <> OLD.status THEN
    IF OLD.status = 'collected' AND in_status = 'received' THEN
      IF btrim(COALESCE(in_condition,'')) = '' THEN RAISE EXCEPTION 'Record the sample condition on receipt'; END IF;
      NEW.status := 'received'; NEW.condition := btrim(in_condition);
      NEW.received_by := auth.uid(); NEW.received_at := now();
    ELSIF OLD.status IN ('collected','received') AND in_status = 'rejected' THEN
      IF btrim(COALESCE(in_reason,'')) = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
      NEW.status := 'rejected'; NEW.rejection_reason := btrim(in_reason);
      NEW.condition := COALESCE(NULLIF(btrim(COALESCE(in_condition,'')),''), OLD.condition);
      NEW.rejected_by := auth.uid(); NEW.rejected_at := now();
    ELSE
      RAISE EXCEPTION 'Specimen status cannot change from % to %', OLD.status, in_status;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_specimen_before BEFORE INSERT OR UPDATE OR DELETE ON public.lab_specimens FOR EACH ROW EXECUTE FUNCTION public.lab_specimen_before();
CREATE TRIGGER lab_specimen_audit AFTER INSERT OR UPDATE ON public.lab_specimens FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- Which tests each specimen was taken for (kept forever, so recollections keep their history)
CREATE TABLE public.lab_specimen_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specimen_id uuid NOT NULL REFERENCES public.lab_specimens(id),
  item_id uuid NOT NULL REFERENCES public.lab_request_items(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (specimen_id, item_id)
);
CREATE INDEX lab_specimen_tests_item_idx ON public.lab_specimen_tests(item_id);
GRANT SELECT, INSERT ON public.lab_specimen_tests TO authenticated;
GRANT ALL ON public.lab_specimen_tests TO service_role;
REVOKE ALL ON public.lab_specimen_tests FROM anon;
ALTER TABLE public.lab_specimen_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab clinical read specimen tests" ON public.lab_specimen_tests FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician','lab_tech']::public.app_role[]));
CREATE POLICY "lab insert specimen tests" ON public.lab_specimen_tests FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'lab_tech'));

CREATE OR REPLACE FUNCTION public.lab_specimen_test_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; i record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Specimen links cannot be changed'; END IF;
  SELECT * INTO s FROM public.lab_specimens WHERE id = NEW.specimen_id;
  SELECT * INTO i FROM public.lab_request_items WHERE id = NEW.item_id;
  IF s IS NULL OR i IS NULL OR s.lab_request_id <> i.lab_request_id THEN
    RAISE EXCEPTION 'The specimen and the test must belong to the same request';
  END IF;
  IF i.status NOT IN ('requested','rejected') THEN RAISE EXCEPTION 'This test is not waiting for a specimen'; END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER lab_specimen_test_before BEFORE INSERT OR UPDATE OR DELETE ON public.lab_specimen_tests FOR EACH ROW EXECUTE FUNCTION public.lab_specimen_test_before();
CREATE TRIGGER lab_specimen_test_audit AFTER INSERT ON public.lab_specimen_tests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- ---------- Test items: new statuses and stamps ----------
ALTER TABLE public.lab_request_items
  ADD COLUMN current_specimen_id uuid REFERENCES public.lab_specimens(id),
  ADD COLUMN received_by uuid,
  ADD COLUMN received_at timestamptz,
  ADD COLUMN submitted_by uuid,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN returned_reason text,
  ADD COLUMN cancelled_by uuid,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancel_reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS lab_request_items_request_idx ON public.lab_request_items(lab_request_id);
CREATE INDEX IF NOT EXISTS lab_request_items_status_idx ON public.lab_request_items(status);
CREATE INDEX IF NOT EXISTS lab_requests_patient_idx ON public.lab_requests(patient_id);
CREATE INDEX IF NOT EXISTS lab_requests_visit_idx ON public.lab_requests(visit_id);
CREATE INDEX IF NOT EXISTS lab_requests_created_idx ON public.lab_requests(created_at);

-- ---------- Results: separate table so clinicians can read only verified values ----------
CREATE TABLE public.lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES public.lab_request_items(id),
  value text NOT NULL,
  abnormal_flag text CHECK (abnormal_flag IN ('L','H','A')),
  comment text,
  unit text,
  ref_low numeric,
  ref_high numeric,
  ref_text text,
  entered_by uuid,
  entered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.lab_results TO authenticated;
GRANT ALL ON public.lab_results TO service_role;
REVOKE ALL ON public.lab_results FROM anon;
REVOKE DELETE, TRUNCATE ON public.lab_results FROM authenticated;
ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab read results; clinicians verified only" ON public.lab_results FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','lab_tech']::public.app_role[])
    OR (public.has_role(auth.uid(),'clinician')
        AND EXISTS (SELECT 1 FROM public.lab_request_items i WHERE i.id = lab_results.item_id AND i.status = 'verified'))
  );
CREATE POLICY "lab insert results" ON public.lab_results FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'lab_tech'));
CREATE POLICY "lab update results" ON public.lab_results FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'lab_tech')) WITH CHECK (public.has_role(auth.uid(),'lab_tech'));

-- Move existing values (with the reference range in force at the time) into lab_results
INSERT INTO public.lab_results (item_id, value, abnormal_flag, comment, unit, ref_low, ref_high, ref_text, entered_by, entered_at)
SELECT i.id, btrim(i.result_value), i.abnormal_flag, i.result_comment, t.unit, t.ref_low, t.ref_high, t.ref_text, i.resulted_by, COALESCE(i.resulted_at, now())
FROM public.lab_request_items i JOIN public.lab_tests t ON t.id = i.lab_test_id
WHERE i.result_value IS NOT NULL AND btrim(i.result_value) <> '';

ALTER TABLE public.lab_request_items DISABLE TRIGGER USER;
ALTER TABLE public.lab_request_items DROP CONSTRAINT lab_request_items_status_check;
UPDATE public.lab_request_items SET status = 'awaiting_verification', submitted_by = resulted_by, submitted_at = resulted_at WHERE status = 'resulted';
UPDATE public.lab_request_items SET result_value = NULL, result_comment = NULL, abnormal_flag = NULL
  WHERE result_value IS NOT NULL OR result_comment IS NOT NULL OR abnormal_flag IS NOT NULL;
ALTER TABLE public.lab_request_items ENABLE TRIGGER USER;
ALTER TABLE public.lab_request_items ADD CONSTRAINT lab_request_items_status_check
  CHECK (status IN ('requested','collected','received','processing','entered','awaiting_verification','verified','rejected','cancelled'));

COMMENT ON COLUMN public.lab_request_items.result_value IS 'DEPRECATED: moved to lab_results.value';
COMMENT ON COLUMN public.lab_request_items.result_comment IS 'DEPRECATED: moved to lab_results.comment';
COMMENT ON COLUMN public.lab_request_items.abnormal_flag IS 'DEPRECATED: moved to lab_results.abnormal_flag';
COMMENT ON COLUMN public.lab_request_items.resulted_by IS 'DEPRECATED: replaced by lab_results.entered_by';
COMMENT ON COLUMN public.lab_request_items.resulted_at IS 'DEPRECATED: replaced by lab_results.entered_at';
COMMENT ON COLUMN public.lab_request_items.specimen_id IS 'DEPRECATED: replaced by current_specimen_id (lab_specimens)';

CREATE OR REPLACE FUNCTION public.lab_result_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it record; t record; v text; num numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Laboratory results cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN NEW.id := OLD.id; NEW.item_id := OLD.item_id; NEW.created_at := OLD.created_at; END IF;
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'lab_tech') THEN RAISE EXCEPTION 'Only laboratory staff can enter results'; END IF;
  SELECT * INTO it FROM public.lab_request_items WHERE id = NEW.item_id;
  IF it IS NULL THEN RAISE EXCEPTION 'Test not found'; END IF;
  IF it.status NOT IN ('processing','entered') THEN
    RAISE EXCEPTION 'Results can only be entered while the test is in processing (current status: %)', it.status;
  END IF;
  SELECT * INTO t FROM public.lab_tests WHERE id = it.lab_test_id;
  v := btrim(COALESCE(NEW.value,''));
  IF v = '' THEN RAISE EXCEPTION 'Enter a result'; END IF;
  IF length(v) > 2000 THEN RAISE EXCEPTION 'Result is too long'; END IF;
  IF length(COALESCE(NEW.comment,'')) > 1000 THEN RAISE EXCEPTION 'Remark is too long'; END IF;
  NEW.value := v;
  NEW.comment := NULLIF(btrim(COALESCE(NEW.comment,'')), '');
  -- snapshot of the configured unit and reference interval at the time of entry
  NEW.unit := t.unit; NEW.ref_low := t.ref_low; NEW.ref_high := t.ref_high; NEW.ref_text := t.ref_text;
  IF t.result_type = 'numeric' THEN
    IF v !~ '^[<>]?-?[0-9]+(\.[0-9]+)?$' THEN RAISE EXCEPTION '% needs a number (e.g. 12.5, or <0.5)', t.name; END IF;
    NEW.abnormal_flag := NULL;
    IF v ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      num := v::numeric;
      IF t.ref_low IS NOT NULL AND num < t.ref_low THEN NEW.abnormal_flag := 'L';
      ELSIF t.ref_high IS NOT NULL AND num > t.ref_high THEN NEW.abnormal_flag := 'H';
      END IF;
    END IF;
  ELSIF t.result_type = 'qualitative' THEN
    IF t.result_options IS NOT NULL AND NOT (v = ANY(t.result_options)) THEN
      RAISE EXCEPTION 'Choose one of: %', array_to_string(t.result_options, ', ');
    END IF;
    NEW.abnormal_flag := CASE WHEN v = ANY(COALESCE(t.abnormal_options, '{}'::text[])) THEN 'A' ELSE NULL END;
  ELSE
    NEW.abnormal_flag := CASE WHEN NEW.abnormal_flag IS NULL THEN NULL ELSE 'A' END;
  END IF;
  NEW.entered_by := auth.uid(); NEW.entered_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER lab_result_before BEFORE INSERT OR UPDATE OR DELETE ON public.lab_results FOR EACH ROW EXECUTE FUNCTION public.lab_result_before();
CREATE TRIGGER lab_result_audit AFTER INSERT OR UPDATE ON public.lab_results FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- ---------- Corrections of verified results (insert-only history) ----------
CREATE TABLE public.lab_result_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.lab_request_items(id),
  lab_request_id uuid NOT NULL REFERENCES public.lab_requests(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  reason text NOT NULL,
  previous_value text,
  previous_flag text,
  previous_comment text,
  previous_unit text,
  previous_ref_low numeric,
  previous_ref_high numeric,
  previous_ref_text text,
  previous_entered_by uuid,
  previous_entered_at timestamptz,
  previous_verified_by uuid,
  previous_verified_at timestamptz,
  amended_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_result_amendments_item_idx ON public.lab_result_amendments(item_id);
CREATE INDEX lab_result_amendments_request_idx ON public.lab_result_amendments(lab_request_id);
GRANT SELECT, INSERT ON public.lab_result_amendments TO authenticated;
GRANT ALL ON public.lab_result_amendments TO service_role;
REVOKE ALL ON public.lab_result_amendments FROM anon;
ALTER TABLE public.lab_result_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab clinical read result amendments" ON public.lab_result_amendments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician','lab_tech']::public.app_role[]));
CREATE POLICY "verifier insert result amendments" ON public.lab_result_amendments FOR INSERT TO authenticated
  WITH CHECK (public.can_verify_lab(auth.uid()));

CREATE OR REPLACE FUNCTION public.lab_result_amendment_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it record; res record; req record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Result corrections are permanent and cannot be changed'; END IF;
  IF NOT public.can_verify_lab(auth.uid()) THEN RAISE EXCEPTION 'Only staff with verification permission can correct a verified result'; END IF;
  SELECT * INTO it FROM public.lab_request_items WHERE id = NEW.item_id;
  IF it IS NULL OR it.status <> 'verified' THEN RAISE EXCEPTION 'Only verified results are corrected this way'; END IF;
  IF btrim(COALESCE(NEW.reason,'')) = '' THEN RAISE EXCEPTION 'A reason for the correction is required'; END IF;
  SELECT * INTO res FROM public.lab_results WHERE item_id = it.id;
  SELECT * INTO req FROM public.lab_requests WHERE id = it.lab_request_id;
  NEW.reason := btrim(NEW.reason);
  NEW.lab_request_id := it.lab_request_id; NEW.patient_id := req.patient_id;
  NEW.previous_value := res.value; NEW.previous_flag := res.abnormal_flag; NEW.previous_comment := res.comment;
  NEW.previous_unit := res.unit; NEW.previous_ref_low := res.ref_low; NEW.previous_ref_high := res.ref_high; NEW.previous_ref_text := res.ref_text;
  NEW.previous_entered_by := res.entered_by; NEW.previous_entered_at := res.entered_at;
  NEW.previous_verified_by := it.verified_by; NEW.previous_verified_at := it.verified_at;
  NEW.amended_by := auth.uid(); NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER lab_result_amendment_before BEFORE INSERT OR UPDATE OR DELETE ON public.lab_result_amendments FOR EACH ROW EXECUTE FUNCTION public.lab_result_amendment_before();
CREATE TRIGGER lab_result_amendment_audit AFTER INSERT ON public.lab_result_amendments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- ---------- Test item workflow (statuses, stamps, verification rules) ----------
CREATE OR REPLACE FUNCTION public.lab_item_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  in_status text; in_spec uuid; in_cancel text; in_return text;
  sp record; res record; self_ok boolean; ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'requested'; NEW.current_specimen_id := NULL; NEW.specimen_id := NULL;
    NEW.collected_by := NULL; NEW.collected_at := NULL; NEW.received_by := NULL; NEW.received_at := NULL;
    NEW.processed_by := NULL; NEW.processed_at := NULL; NEW.submitted_by := NULL; NEW.submitted_at := NULL;
    NEW.verified_by := NULL; NEW.verified_at := NULL; NEW.cancelled_by := NULL; NEW.cancelled_at := NULL; NEW.cancel_reason := NULL;
    NEW.result_value := NULL; NEW.result_comment := NULL; NEW.abnormal_flag := NULL; NEW.resulted_by := NULL; NEW.resulted_at := NULL;
    NEW.rejection_reason := NULL; NEW.returned_reason := NULL; NEW.updated_at := now();
    RETURN NEW;
  END IF;
  in_status := NEW.status; in_spec := NEW.current_specimen_id; in_cancel := NEW.cancel_reason; in_return := NEW.returned_reason;
  IF in_status = OLD.status THEN RETURN OLD; END IF; -- tests change only through status steps
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'lab_tech') THEN
    RAISE EXCEPTION 'Only laboratory staff can update laboratory tests';
  END IF;
  ok := CASE OLD.status
    WHEN 'requested' THEN in_status IN ('collected','cancelled')
    WHEN 'collected' THEN in_status IN ('received','rejected','cancelled')
    WHEN 'received' THEN in_status IN ('processing','rejected','cancelled')
    WHEN 'processing' THEN in_status IN ('entered','rejected','cancelled')
    WHEN 'entered' THEN in_status IN ('awaiting_verification','cancelled')
    WHEN 'awaiting_verification' THEN in_status IN ('verified','entered')
    WHEN 'rejected' THEN in_status IN ('collected','cancelled')
    WHEN 'verified' THEN in_status = 'entered'
    ELSE false END;
  IF NOT ok THEN
    IF OLD.status = 'verified' THEN RAISE EXCEPTION 'This result is verified and final; correct it with a documented reason'; END IF;
    IF OLD.status = 'cancelled' THEN RAISE EXCEPTION 'This test was cancelled and cannot be changed'; END IF;
    RAISE EXCEPTION 'Test status cannot change from % to %', OLD.status, in_status;
  END IF;
  NEW := OLD;
  NEW.status := in_status; NEW.updated_at := now();
  IF in_status = 'collected' THEN
    SELECT * INTO sp FROM public.lab_specimens WHERE id = in_spec;
    IF sp IS NULL OR sp.status = 'rejected'
       OR NOT EXISTS (SELECT 1 FROM public.lab_specimen_tests WHERE specimen_id = in_spec AND item_id = OLD.id) THEN
      RAISE EXCEPTION 'Register the specimen for this test first';
    END IF;
    NEW.current_specimen_id := in_spec; NEW.collected_by := sp.collected_by; NEW.collected_at := sp.collected_at;
    NEW.received_by := NULL; NEW.received_at := NULL; NEW.processed_by := NULL; NEW.processed_at := NULL;
    NEW.rejection_reason := NULL;
  ELSIF in_status = 'received' THEN
    SELECT * INTO sp FROM public.lab_specimens WHERE id = OLD.current_specimen_id;
    IF sp IS NULL OR sp.status <> 'received' THEN RAISE EXCEPTION 'Mark the specimen as received first'; END IF;
    NEW.received_by := sp.received_by; NEW.received_at := sp.received_at;
  ELSIF in_status = 'processing' THEN
    NEW.processed_by := auth.uid(); NEW.processed_at := now();
  ELSIF in_status = 'entered' THEN
    SELECT * INTO res FROM public.lab_results WHERE item_id = OLD.id;
    IF res IS NULL THEN RAISE EXCEPTION 'Enter a result first'; END IF;
    IF OLD.status = 'awaiting_verification' THEN
      IF btrim(COALESCE(in_return,'')) = '' THEN RAISE EXCEPTION 'Give a reason for returning this result for correction'; END IF;
      IF NOT (public.can_verify_lab(auth.uid()) OR res.entered_by = auth.uid()) THEN
        RAISE EXCEPTION 'Only a verifier or the person who entered the result can return it';
      END IF;
      NEW.returned_reason := btrim(in_return);
    ELSIF OLD.status = 'verified' THEN
      SELECT reason INTO NEW.returned_reason FROM public.lab_result_amendments
        WHERE item_id = OLD.id AND created_at = now() ORDER BY id LIMIT 1;
      IF NEW.returned_reason IS NULL THEN RAISE EXCEPTION 'Record the reason for correcting a verified result first'; END IF;
    ELSE
      NEW.returned_reason := NULL;
    END IF;
    NEW.submitted_by := NULL; NEW.submitted_at := NULL; NEW.verified_by := NULL; NEW.verified_at := NULL;
  ELSIF in_status = 'awaiting_verification' THEN
    IF NOT EXISTS (SELECT 1 FROM public.lab_results WHERE item_id = OLD.id) THEN RAISE EXCEPTION 'Enter a result first'; END IF;
    NEW.submitted_by := auth.uid(); NEW.submitted_at := now();
  ELSIF in_status = 'verified' THEN
    IF NOT public.can_verify_lab(auth.uid()) THEN RAISE EXCEPTION 'You do not have permission to verify laboratory results'; END IF;
    SELECT * INTO res FROM public.lab_results WHERE item_id = OLD.id;
    IF res IS NULL THEN RAISE EXCEPTION 'There is no result to verify'; END IF;
    SELECT can_self_verify INTO self_ok FROM public.profiles WHERE id = auth.uid();
    IF res.entered_by = auth.uid() AND NOT COALESCE(self_ok,false) THEN
      RAISE EXCEPTION 'A different technician must verify this result';
    END IF;
    NEW.verified_by := auth.uid(); NEW.verified_at := now(); NEW.returned_reason := NULL;
  ELSIF in_status = 'rejected' THEN
    SELECT * INTO sp FROM public.lab_specimens WHERE id = OLD.current_specimen_id;
    IF sp IS NULL OR sp.status <> 'rejected' THEN RAISE EXCEPTION 'Reject the specimen first'; END IF;
    NEW.rejection_reason := sp.rejection_reason;
  ELSIF in_status = 'cancelled' THEN
    IF btrim(COALESCE(in_cancel,'')) = '' THEN RAISE EXCEPTION 'A reason is required to cancel a test'; END IF;
    NEW.cancel_reason := btrim(in_cancel); NEW.cancelled_by := auth.uid(); NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END $$;

-- Request status and "Ready for review" for OPD: final = verified or cancelled
CREATE OR REPLACE FUNCTION public.lab_item_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE open_count int; total int; cancelled_count int; vid uuid;
BEGIN
  SELECT count(*) FILTER (WHERE status NOT IN ('verified','cancelled')), count(*), count(*) FILTER (WHERE status = 'cancelled')
    INTO open_count, total, cancelled_count FROM public.lab_request_items WHERE lab_request_id = NEW.lab_request_id;
  UPDATE public.lab_requests SET status = CASE
      WHEN open_count = 0 AND cancelled_count = total THEN 'cancelled'
      WHEN open_count = 0 THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM public.lab_request_items WHERE lab_request_id = NEW.lab_request_id AND status <> 'requested') THEN 'in_progress'
      ELSE 'requested' END
    WHERE id = NEW.lab_request_id;
  SELECT visit_id INTO vid FROM public.lab_requests WHERE id = NEW.lab_request_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id
    WHERE r.visit_id = vid AND i.status NOT IN ('verified','cancelled')
  ) THEN
    UPDATE public.visits SET status = 'ready_for_review' WHERE id = vid AND status = 'awaiting_lab';
  END IF;
  RETURN NEW;
END $$;

-- Requests: status is maintained only by the test-item trigger; core details are immutable
REVOKE UPDATE, DELETE, TRUNCATE ON public.lab_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.lab_request_items FROM anon;
REVOKE DELETE, TRUNCATE ON public.lab_request_items FROM authenticated;

CREATE OR REPLACE FUNCTION public.lab_request_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.request_number := 'LR-' || to_char(now() AT TIME ZONE 'Africa/Addis_Ababa','YYMMDD') || '-' || lpad(nextval('public.lab_request_seq')::text, 5, '0');
  NEW.requested_by := auth.uid();
  RETURN NEW;
END $$;

-- ---------- Laboratory actions (atomic; RLS and the triggers above still apply) ----------
CREATE OR REPLACE FUNCTION public.receive_specimen(_specimen_id uuid, _condition text, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE public.lab_specimens SET status = 'received', condition = _condition, notes = COALESCE(NULLIF(btrim(COALESCE(_notes,'')),''), notes)
    WHERE id = _specimen_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Specimen not found'; END IF;
  UPDATE public.lab_request_items SET status = 'received' WHERE current_specimen_id = _specimen_id AND status = 'collected';
END $$;

CREATE OR REPLACE FUNCTION public.collect_specimen(
  _request_id uuid, _item_ids uuid[], _specimen_type text, _collected_at timestamptz DEFAULT NULL,
  _collected_by uuid DEFAULT NULL, _received boolean DEFAULT false, _condition text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE sp_id uuid; acc text; prev uuid; n int; wanted int;
BEGIN
  IF NOT public.has_role(auth.uid(),'lab_tech') THEN RAISE EXCEPTION 'Only laboratory staff can register specimens'; END IF;
  IF _item_ids IS NULL OR cardinality(_item_ids) = 0 THEN RAISE EXCEPTION 'Choose the tests this specimen is for'; END IF;
  SELECT count(DISTINCT x) INTO wanted FROM unnest(_item_ids) x;
  SELECT count(*) INTO n FROM public.lab_request_items
    WHERE id = ANY(_item_ids) AND lab_request_id = _request_id AND status IN ('requested','rejected');
  IF n <> wanted THEN RAISE EXCEPTION 'Some selected tests are not waiting for a specimen'; END IF;
  SELECT current_specimen_id INTO prev FROM public.lab_request_items
    WHERE id = ANY(_item_ids) AND status = 'rejected' AND current_specimen_id IS NOT NULL LIMIT 1;
  INSERT INTO public.lab_specimens (lab_request_id, patient_id, specimen_type, collected_at, collected_by, notes, replaces_specimen_id)
    VALUES (_request_id, (SELECT patient_id FROM public.lab_requests WHERE id = _request_id), _specimen_type,
            COALESCE(_collected_at, now()), COALESCE(_collected_by, auth.uid()), _notes, prev)
    RETURNING id, accession_number INTO sp_id, acc;
  INSERT INTO public.lab_specimen_tests (specimen_id, item_id) SELECT sp_id, x FROM (SELECT DISTINCT unnest(_item_ids) AS x) s;
  UPDATE public.lab_request_items SET status = 'collected', current_specimen_id = sp_id WHERE id = ANY(_item_ids);
  IF _received THEN PERFORM public.receive_specimen(sp_id, _condition, NULL); END IF;
  RETURN jsonb_build_object('id', sp_id, 'accession_number', acc);
END $$;

CREATE OR REPLACE FUNCTION public.reject_specimen(_specimen_id uuid, _reason text, _condition text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lab_request_items WHERE current_specimen_id = _specimen_id
             AND status IN ('entered','awaiting_verification','verified')) THEN
    RAISE EXCEPTION 'A result was already entered for a test on this specimen';
  END IF;
  UPDATE public.lab_specimens SET status = 'rejected', rejection_reason = _reason, condition = _condition WHERE id = _specimen_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Specimen not found'; END IF;
  UPDATE public.lab_request_items SET status = 'rejected'
    WHERE current_specimen_id = _specimen_id AND status IN ('collected','received','processing');
END $$;

CREATE OR REPLACE FUNCTION public.save_lab_result(_item_id uuid, _value text, _comment text DEFAULT NULL, _flag text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE s text; out jsonb;
BEGIN
  SELECT status INTO s FROM public.lab_request_items WHERE id = _item_id;
  IF s IS NULL THEN RAISE EXCEPTION 'Test not found'; END IF;
  IF s = 'received' THEN
    UPDATE public.lab_request_items SET status = 'processing' WHERE id = _item_id;
    s := 'processing';
  END IF;
  INSERT INTO public.lab_results (item_id, value, comment, abnormal_flag)
    VALUES (_item_id, _value, _comment, NULLIF(_flag,''))
    ON CONFLICT (item_id) DO UPDATE SET value = EXCLUDED.value, comment = EXCLUDED.comment, abnormal_flag = EXCLUDED.abnormal_flag;
  IF s = 'processing' THEN UPDATE public.lab_request_items SET status = 'entered' WHERE id = _item_id; END IF;
  SELECT to_jsonb(r) INTO out FROM public.lab_results r WHERE item_id = _item_id;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.amend_lab_result(_item_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  INSERT INTO public.lab_result_amendments (item_id, lab_request_id, patient_id, reason)
    SELECT i.id, i.lab_request_id, r.patient_id, _reason
    FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id WHERE i.id = _item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Test not found'; END IF;
  UPDATE public.lab_request_items SET status = 'entered' WHERE id = _item_id;
END $$;

REVOKE ALL ON FUNCTION public.receive_specimen(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collect_specimen(uuid, uuid[], text, timestamptz, uuid, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_specimen(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_lab_result(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.amend_lab_result(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_specimen(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_specimen(uuid, uuid[], text, timestamptz, uuid, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_specimen(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_lab_result(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amend_lab_result(uuid, text) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_specimens;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_results;
