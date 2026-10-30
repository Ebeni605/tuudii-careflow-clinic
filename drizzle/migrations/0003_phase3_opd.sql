-- ===== Visit statuses: add "ready_for_review" (all lab results back) =====
ALTER TABLE public.visits DROP CONSTRAINT visits_status_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_status_check
  CHECK (status IN ('waiting','in_consultation','awaiting_lab','ready_for_review','completed','cancelled','no_show'));
DROP INDEX public.visits_one_active_per_patient_day;
CREATE UNIQUE INDEX visits_one_active_per_patient_day ON public.visits (patient_id, queue_date)
  WHERE status IN ('waiting','in_consultation','awaiting_lab','ready_for_review');

-- ===== Consultation (encounter): draft -> signed, extra sections =====
ALTER TABLE public.consultations
  ADD COLUMN medication_history text,
  ADD COLUMN allergy_history text,
  ADD COLUMN family_social_history text,
  ADD COLUMN assessment text,
  ADD COLUMN referral_notes text,
  ADD COLUMN lab_review_notes text,
  ADD COLUMN status text NOT NULL DEFAULT 'draft',
  ADD COLUMN signed_by uuid,
  ADD COLUMN signed_at timestamptz,
  ADD COLUMN updated_by uuid;
-- notes of visits already completed count as signed
UPDATE public.consultations c SET status = 'signed', signed_at = c.updated_at, signed_by = c.clinician_id
  FROM public.visits v WHERE v.id = c.visit_id AND v.status = 'completed';
ALTER TABLE public.consultations ADD CONSTRAINT consultations_status_check CHECK (status IN ('draft','signed'));

-- ===== Diagnosis catalogue =====
CREATE TABLE public.diagnosis_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icd10_code text,
  category text,
  display_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diagnosis_catalog_name_unique UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE ON public.diagnosis_catalog TO authenticated;
GRANT ALL ON public.diagnosis_catalog TO service_role;
ALTER TABLE public.diagnosis_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read dx catalog" ON public.diagnosis_catalog FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write dx catalog" ON public.diagnosis_catalog FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER dx_catalog_audit AFTER INSERT OR UPDATE OR DELETE ON public.diagnosis_catalog FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

ALTER TABLE public.diagnoses
  ADD COLUMN catalog_id uuid REFERENCES public.diagnosis_catalog(id),
  ADD COLUMN consultation_id uuid REFERENCES public.consultations(id);
UPDATE public.diagnoses d SET consultation_id = c.id FROM public.consultations c WHERE c.visit_id = d.visit_id;

-- ===== Medication instructions (written by the clinician; no pharmacy) =====
CREATE TABLE public.medication_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id),
  medicine text NOT NULL,
  dose text,
  route text,
  frequency text,
  duration text,
  instructions text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medication_instructions_visit_idx ON public.medication_instructions(visit_id);
GRANT SELECT, INSERT, DELETE ON public.medication_instructions TO authenticated;
GRANT ALL ON public.medication_instructions TO service_role;
ALTER TABLE public.medication_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinical read meds" ON public.medication_instructions FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician']::public.app_role[]));
CREATE POLICY "clinician insert meds" ON public.medication_instructions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE POLICY "clinician delete meds" ON public.medication_instructions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'clinician'));
CREATE TRIGGER meds_audit AFTER INSERT OR UPDATE OR DELETE ON public.medication_instructions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- ===== Amendments to signed notes (insert-only) =====
CREATE TABLE public.consultation_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  kind text NOT NULL DEFAULT 'addendum' CHECK (kind IN ('addendum','correction','result_review')),
  section text,
  note text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consultation_amendments_consult_idx ON public.consultation_amendments(consultation_id);
GRANT SELECT, INSERT ON public.consultation_amendments TO authenticated;
GRANT ALL ON public.consultation_amendments TO service_role;
ALTER TABLE public.consultation_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinical read amendments" ON public.consultation_amendments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician']::public.app_role[]));
CREATE POLICY "clinician insert amendments" ON public.consultation_amendments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE TRIGGER amend_audit AFTER INSERT OR UPDATE OR DELETE ON public.consultation_amendments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- ===== Lab orders link to the encounter =====
ALTER TABLE public.lab_requests ADD COLUMN consultation_id uuid REFERENCES public.consultations(id);
UPDATE public.lab_requests r SET consultation_id = c.id FROM public.consultations c WHERE c.visit_id = r.visit_id;

-- ===== Vital signs: BMI, history kept (no edits) =====
ALTER TABLE public.vital_signs ADD COLUMN bmi numeric(4,1) GENERATED ALWAYS AS (
  CASE WHEN weight_kg > 0 AND height_cm >= 30 THEN round(weight_kg / (height_cm * height_cm / 10000.0), 1) END
) STORED;
DROP POLICY "clinical update vitals" ON public.vital_signs;
REVOKE UPDATE ON public.vital_signs FROM authenticated;

-- ===== Trigger functions =====
CREATE OR REPLACE FUNCTION public.visit_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE appt record; is_archived boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT archived INTO is_archived FROM public.patients WHERE id = NEW.patient_id;
    IF is_archived THEN RAISE EXCEPTION 'This patient record is archived'; END IF;
    NEW.queue_date := public.clinic_today();
    IF EXISTS (SELECT 1 FROM public.visits WHERE patient_id = NEW.patient_id AND queue_date = NEW.queue_date
               AND status IN ('waiting','in_consultation','awaiting_lab','ready_for_review')) THEN
      RAISE EXCEPTION 'This patient is already in today''s queue';
    END IF;
    IF NEW.appointment_id IS NOT NULL THEN
      SELECT * INTO appt FROM public.appointments WHERE id = NEW.appointment_id;
      IF appt IS NULL OR appt.patient_id <> NEW.patient_id THEN RAISE EXCEPTION 'Appointment does not belong to this patient'; END IF;
      IF appt.status <> 'scheduled' THEN RAISE EXCEPTION 'This appointment is not scheduled'; END IF;
      IF (appt.scheduled_at AT TIME ZONE 'Africa/Addis_Ababa')::date <> NEW.queue_date THEN
        RAISE EXCEPTION 'Only today''s appointments can be checked in';
      END IF;
      NEW.visit_type := 'appointment';
    ELSE
      NEW.visit_type := 'walk_in';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('queue' || NEW.queue_date::text));
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO NEW.queue_number FROM public.visits WHERE queue_date = NEW.queue_date;
    NEW.status := 'waiting';
    NEW.checked_in_by := COALESCE(auth.uid(), NEW.checked_in_by);
    NEW.checked_in_at := now();
    NEW.started_at := NULL; NEW.completed_at := NULL;
    IF length(COALESCE(NEW.reception_notes, '')) > 300 THEN RAISE EXCEPTION 'Notes must be 300 characters or fewer'; END IF;
  ELSE
    NEW.queue_number := OLD.queue_number;
    NEW.queue_date := OLD.queue_date;
    NEW.patient_id := OLD.patient_id;
    NEW.appointment_id := OLD.appointment_id;
    NEW.visit_type := OLD.visit_type;
    NEW.checked_in_by := OLD.checked_in_by;
    NEW.checked_in_at := OLD.checked_in_at;
    IF NEW.service_key IS DISTINCT FROM OLD.service_key AND OLD.status <> 'waiting' THEN
      RAISE EXCEPTION 'The service can only be changed while the patient is waiting';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'waiting' AND NEW.status IN ('in_consultation','cancelled','no_show')) OR
        (OLD.status = 'in_consultation' AND NEW.status IN ('awaiting_lab','completed','waiting')) OR
        (OLD.status = 'awaiting_lab' AND NEW.status IN ('in_consultation','ready_for_review','completed')) OR
        (OLD.status = 'ready_for_review' AND NEW.status IN ('in_consultation','awaiting_lab','completed'))
      ) THEN
        RAISE EXCEPTION 'Visit status cannot change from % to %', OLD.status, NEW.status;
      END IF;
      -- consultation steps belong to OPD clinicians (system/trigger updates have no user or come from the lab)
      IF auth.uid() IS NOT NULL
         AND (NEW.status IN ('in_consultation','awaiting_lab','completed') OR (OLD.status = 'in_consultation' AND NEW.status = 'waiting'))
         AND NOT public.has_role(auth.uid(), 'clinician') THEN
        RAISE EXCEPTION 'Only an OPD clinician can move a visit to this status';
      END IF;
      IF NEW.status = 'completed' AND NOT EXISTS (
        SELECT 1 FROM public.consultations WHERE visit_id = NEW.id AND status = 'signed') THEN
        RAISE EXCEPTION 'Sign the consultation note before completing the visit';
      END IF;
      IF NEW.status = 'in_consultation' AND OLD.started_at IS NULL THEN
        NEW.started_at := now();
        NEW.assigned_clinician_id := COALESCE(NEW.assigned_clinician_id, auth.uid());
      ELSE
        NEW.started_at := OLD.started_at;
      END IF;
      IF NEW.status = 'completed' THEN NEW.completed_at := now(); ELSE NEW.completed_at := OLD.completed_at; END IF;
    ELSE
      NEW.started_at := OLD.started_at; NEW.completed_at := OLD.completed_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.visit_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE public.appointments SET status = 'checked_in' WHERE id = NEW.appointment_id AND status = 'scheduled';
    ELSIF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
      UPDATE public.appointments SET status = 'completed' WHERE id = NEW.appointment_id AND status = 'checked_in';
    END IF;
  END IF;
  -- one encounter per visit, opened when the clinician starts the consultation
  IF TG_OP = 'UPDATE' AND NEW.status = 'in_consultation' AND OLD.status <> 'in_consultation' THEN
    INSERT INTO public.consultations (visit_id, patient_id, service_key, clinician_id)
    VALUES (NEW.id, NEW.patient_id, NEW.service_key, COALESCE(auth.uid(), NEW.assigned_clinician_id))
    ON CONFLICT (visit_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.consult_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; problems text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v FROM public.visits WHERE id = NEW.visit_id;
  IF TG_OP = 'INSERT' THEN
    IF v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
    IF v.status NOT IN ('in_consultation','awaiting_lab','ready_for_review') THEN
      RAISE EXCEPTION 'Start the consultation first';
    END IF;
    NEW.patient_id := v.patient_id;
    NEW.service_key := v.service_key;
    NEW.status := 'draft';
    NEW.signed_by := NULL; NEW.signed_at := NULL;
    NEW.clinician_id := COALESCE(auth.uid(), NEW.clinician_id);
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'This consultation is signed and cannot be changed. Add an amendment instead.';
  END IF;
  NEW.visit_id := OLD.visit_id; NEW.patient_id := OLD.patient_id; NEW.service_key := OLD.service_key;
  NEW.clinician_id := OLD.clinician_id; NEW.created_at := OLD.created_at;
  NEW.updated_by := auth.uid();
  IF v.status NOT IN ('in_consultation','awaiting_lab','ready_for_review') THEN
    RAISE EXCEPTION 'This visit is not open for consultation';
  END IF;
  IF NEW.status = 'signed' THEN
    IF btrim(COALESCE(NEW.chief_complaint,'')) = '' THEN
      problems := problems || (CASE WHEN NEW.service_key = 'laboratory' THEN 'clinical indication / complaint' ELSE 'chief complaint' END);
    END IF;
    IF NEW.service_key = 'laboratory' THEN
      IF NOT EXISTS (SELECT 1 FROM public.lab_requests WHERE visit_id = NEW.visit_id) THEN problems := problems || 'at least one laboratory order'::text; END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.diagnoses WHERE visit_id = NEW.visit_id) THEN problems := problems || 'at least one diagnosis'::text; END IF;
      IF btrim(COALESCE(NEW.treatment_notes,'')) = '' THEN problems := problems || 'treatment / management plan'::text; END IF;
    END IF;
    IF NEW.service_key = 'minor_surgery' AND COALESCE(NEW.template_data->>'consent','') <> 'true' THEN
      problems := problems || 'documented consent'::text;
    END IF;
    IF NEW.service_key = 'infant_circumcision' THEN
      IF COALESCE(NEW.template_data->>'guardian_consent','') <> 'true' THEN problems := problems || 'documented guardian consent'::text; END IF;
      IF btrim(COALESCE(NEW.template_data->>'guardian_name','')) = '' THEN problems := problems || 'guardian name'::text; END IF;
    END IF;
    IF cardinality(problems) > 0 THEN
      RAISE EXCEPTION 'Cannot sign yet. Missing: %', array_to_string(problems, ', ');
    END IF;
    NEW.signed_by := auth.uid(); NEW.signed_at := now();
  ELSE
    NEW.signed_by := NULL; NEW.signed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consult_before BEFORE INSERT OR UPDATE ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.consult_before();

-- Diagnoses and medication instructions can change only while the note is a draft
CREATE OR REPLACE FUNCTION public.encounter_child_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO c FROM public.consultations WHERE visit_id = OLD.visit_id;
    IF c IS NOT NULL AND c.status = 'signed' THEN
      RAISE EXCEPTION 'This consultation is signed. Add an amendment instead.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Entries cannot be edited; remove and add again while the note is a draft'; END IF;
  SELECT * INTO c FROM public.consultations WHERE visit_id = NEW.visit_id;
  IF c IS NULL THEN RAISE EXCEPTION 'Start the consultation first'; END IF;
  IF c.status = 'signed' THEN RAISE EXCEPTION 'This consultation is signed. Add an amendment instead.'; END IF;
  NEW.patient_id := c.patient_id;
  NEW.consultation_id := c.id;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER dx_guard BEFORE INSERT OR UPDATE OR DELETE ON public.diagnoses FOR EACH ROW EXECUTE FUNCTION public.encounter_child_guard();
CREATE TRIGGER meds_guard BEFORE INSERT OR UPDATE OR DELETE ON public.medication_instructions FOR EACH ROW EXECUTE FUNCTION public.encounter_child_guard();

CREATE OR REPLACE FUNCTION public.meds_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF btrim(COALESCE(NEW.medicine,'')) = '' THEN RAISE EXCEPTION 'Enter the medicine name'; END IF;
  IF length(NEW.medicine) > 150 OR length(COALESCE(NEW.dose,'')) > 60 OR length(COALESCE(NEW.route,'')) > 40
     OR length(COALESCE(NEW.frequency,'')) > 60 OR length(COALESCE(NEW.duration,'')) > 60 OR length(COALESCE(NEW.instructions,'')) > 300 THEN
    RAISE EXCEPTION 'One of the medication fields is too long';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meds_validate BEFORE INSERT ON public.medication_instructions FOR EACH ROW EXECUTE FUNCTION public.meds_validate();

CREATE OR REPLACE FUNCTION public.amendment_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Amendments cannot be changed'; END IF;
  SELECT * INTO c FROM public.consultations WHERE id = NEW.consultation_id;
  IF c IS NULL THEN RAISE EXCEPTION 'Consultation not found'; END IF;
  IF c.status <> 'signed' THEN RAISE EXCEPTION 'Edit the draft note directly; amendments are for signed notes'; END IF;
  IF btrim(COALESCE(NEW.note,'')) = '' THEN RAISE EXCEPTION 'Write the amendment'; END IF;
  IF length(NEW.note) > 2000 THEN RAISE EXCEPTION 'Amendment must be 2000 characters or fewer'; END IF;
  IF NEW.kind = 'correction' AND btrim(COALESCE(NEW.section,'')) = '' THEN RAISE EXCEPTION 'Say which part of the note is being corrected'; END IF;
  NEW.visit_id := c.visit_id; NEW.patient_id := c.patient_id;
  NEW.created_by := auth.uid(); NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER amendment_before BEFORE INSERT OR UPDATE OR DELETE ON public.consultation_amendments FOR EACH ROW EXECUTE FUNCTION public.amendment_before();

-- Vitals: plausibility checks, stamps, no edits
CREATE OR REPLACE FUNCTION public.vitals_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Recorded vital signs cannot be changed; record a new measurement'; END IF;
  SELECT * INTO v FROM public.visits WHERE id = NEW.visit_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF v.status NOT IN ('waiting','in_consultation','awaiting_lab','ready_for_review') THEN
    RAISE EXCEPTION 'This visit is closed; vital signs can no longer be added';
  END IF;
  IF num_nonnulls(NEW.bp_systolic, NEW.bp_diastolic, NEW.pulse, NEW.temperature, NEW.resp_rate, NEW.spo2, NEW.weight_kg, NEW.height_cm, NEW.blood_glucose) = 0 THEN
    RAISE EXCEPTION 'Enter at least one measurement';
  END IF;
  IF (NEW.bp_systolic IS NULL) <> (NEW.bp_diastolic IS NULL) THEN RAISE EXCEPTION 'Enter both systolic and diastolic blood pressure'; END IF;
  IF NEW.bp_systolic IS NOT NULL AND (NEW.bp_systolic NOT BETWEEN 50 AND 260 OR NEW.bp_diastolic NOT BETWEEN 30 AND 160 OR NEW.bp_diastolic >= NEW.bp_systolic) THEN
    RAISE EXCEPTION 'Blood pressure value is out of the possible range';
  END IF;
  IF NEW.pulse IS NOT NULL AND NEW.pulse NOT BETWEEN 20 AND 250 THEN RAISE EXCEPTION 'Pulse rate is out of the possible range'; END IF;
  IF NEW.resp_rate IS NOT NULL AND NEW.resp_rate NOT BETWEEN 4 AND 80 THEN RAISE EXCEPTION 'Respiratory rate is out of the possible range'; END IF;
  IF NEW.temperature IS NOT NULL AND NEW.temperature NOT BETWEEN 30 AND 45 THEN RAISE EXCEPTION 'Temperature is out of the possible range'; END IF;
  IF NEW.spo2 IS NOT NULL AND NEW.spo2 NOT BETWEEN 50 AND 100 THEN RAISE EXCEPTION 'SpO2 is out of the possible range'; END IF;
  IF NEW.weight_kg IS NOT NULL AND NEW.weight_kg NOT BETWEEN 0.5 AND 300 THEN RAISE EXCEPTION 'Weight is out of the possible range'; END IF;
  IF NEW.height_cm IS NOT NULL AND NEW.height_cm NOT BETWEEN 30 AND 250 THEN RAISE EXCEPTION 'Height is out of the possible range'; END IF;
  IF NEW.blood_glucose IS NOT NULL AND NEW.blood_glucose NOT BETWEEN 20 AND 800 THEN RAISE EXCEPTION 'Blood glucose is out of the possible range'; END IF;
  NEW.patient_id := v.patient_id;
  NEW.recorded_by := COALESCE(auth.uid(), NEW.recorded_by);
  NEW.recorded_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER vitals_before BEFORE INSERT OR UPDATE ON public.vital_signs FOR EACH ROW EXECUTE FUNCTION public.vitals_before();

-- Lab orders: linked to patient, visit and encounter
CREATE OR REPLACE FUNCTION public.lab_request_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO c FROM public.consultations WHERE visit_id = NEW.visit_id;
    IF c IS NULL THEN RAISE EXCEPTION 'Start the consultation first'; END IF;
    IF c.status = 'signed' THEN RAISE EXCEPTION 'This consultation is signed; new lab orders need a new visit'; END IF;
    NEW.patient_id := c.patient_id;
    NEW.consultation_id := c.id;
    NEW.status := 'requested';
    NEW.created_at := now();
    IF length(COALESCE(NEW.clinical_notes,'')) > 500 THEN RAISE EXCEPTION 'Clinical notes must be 500 characters or fewer'; END IF;
  ELSE
    NEW.visit_id := OLD.visit_id; NEW.patient_id := OLD.patient_id; NEW.consultation_id := OLD.consultation_id;
    NEW.request_number := OLD.request_number; NEW.requested_by := OLD.requested_by; NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_request_link BEFORE INSERT OR UPDATE ON public.lab_requests FOR EACH ROW EXECUTE FUNCTION public.lab_request_link();

-- When every test of a visit is final, the visit becomes "Ready for review"
CREATE OR REPLACE FUNCTION public.lab_item_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE open_count int; total int; vid uuid;
BEGIN
  SELECT count(*) FILTER (WHERE status NOT IN ('verified','rejected')), count(*)
    INTO open_count, total FROM public.lab_request_items WHERE lab_request_id = NEW.lab_request_id;
  UPDATE public.lab_requests SET status = CASE
      WHEN open_count = 0 THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM public.lab_request_items WHERE lab_request_id = NEW.lab_request_id AND status <> 'requested') THEN 'in_progress'
      ELSE 'requested' END
    WHERE id = NEW.lab_request_id AND status <> 'cancelled';
  SELECT visit_id INTO vid FROM public.lab_requests WHERE id = NEW.lab_request_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id
    WHERE r.visit_id = vid AND r.status <> 'cancelled' AND i.status NOT IN ('verified','rejected')
  ) THEN
    UPDATE public.visits SET status = 'ready_for_review' WHERE id = vid AND status = 'awaiting_lab';
  END IF;
  RETURN NEW;
END $$;

-- One-step lab order from OPD: request + tests + visit status, all or nothing
CREATE OR REPLACE FUNCTION public.create_lab_order(_visit_id uuid, _test_ids uuid[], _priority text DEFAULT 'routine', _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_status text; v_patient uuid; req_id uuid; req_no text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'clinician') THEN RAISE EXCEPTION 'Only an OPD clinician can request laboratory tests'; END IF;
  IF _test_ids IS NULL OR cardinality(_test_ids) = 0 THEN RAISE EXCEPTION 'Tick at least one test'; END IF;
  IF _priority NOT IN ('routine','urgent') THEN RAISE EXCEPTION 'Priority must be routine or urgent'; END IF;
  SELECT status, patient_id INTO v_status, v_patient FROM public.visits WHERE id = _visit_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF v_status NOT IN ('in_consultation','awaiting_lab','ready_for_review') THEN RAISE EXCEPTION 'Start the consultation first'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_test_ids) t(tid) LEFT JOIN public.lab_tests l ON l.id = t.tid WHERE l.id IS NULL OR NOT l.active) THEN
    RAISE EXCEPTION 'One of the selected tests is not available';
  END IF;
  INSERT INTO public.lab_requests (visit_id, patient_id, priority, clinical_notes)
    VALUES (_visit_id, v_patient, _priority, NULLIF(btrim(COALESCE(_notes,'')), ''))
    RETURNING id, request_number INTO req_id, req_no;
  INSERT INTO public.lab_request_items (lab_request_id, lab_test_id)
    SELECT req_id, tid FROM (SELECT DISTINCT unnest(_test_ids) AS tid) s;
  IF v_status <> 'awaiting_lab' THEN
    UPDATE public.visits SET status = 'awaiting_lab' WHERE id = _visit_id;
  END IF;
  RETURN jsonb_build_object('id', req_id, 'request_number', req_no);
END $$;
REVOKE ALL ON FUNCTION public.create_lab_order(uuid, uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lab_order(uuid, uuid[], text, text) TO authenticated;
