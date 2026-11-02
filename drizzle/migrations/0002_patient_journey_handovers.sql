-- ===== Patient journey: Reception -> OPD -> (Lab) -> OPD -> Reception payment -> Completed =====

-- 1. Visit number and extended visit steps
ALTER TABLE public.visits ADD COLUMN visit_number text;
UPDATE public.visits SET visit_number = 'V-' || to_char(queue_date, 'YYMMDD') || '-' || lpad(queue_number::text, 3, '0') WHERE visit_number IS NULL AND queue_number IS NOT NULL;
CREATE UNIQUE INDEX visits_visit_number_key ON public.visits (visit_number);

ALTER TABLE public.visits DROP CONSTRAINT visits_status_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_status_check CHECK (status IN (
  'waiting','in_consultation','awaiting_lab','lab_processing','ready_for_review',
  'awaiting_payment','partially_paid','ready_to_close','completed','cancelled','no_show'));

DROP INDEX public.visits_one_active_per_patient_day;
CREATE UNIQUE INDEX visits_one_active_per_patient_day ON public.visits (patient_id, queue_date)
  WHERE status IN ('waiting','in_consultation','awaiting_lab','lab_processing','ready_for_review','awaiting_payment','partially_paid','ready_to_close');

ALTER TABLE public.lab_requests ADD COLUMN accepted_by uuid REFERENCES public.profiles(id), ADD COLUMN accepted_at timestamptz;

-- Department that currently holds the patient for a visit step
CREATE OR REPLACE FUNCTION public.visit_department(_status text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _status IN ('waiting','in_consultation','ready_for_review','ready_to_close') THEN 'opd'
    WHEN _status IN ('awaiting_lab','lab_processing') THEN 'lab'
    WHEN _status IN ('awaiting_payment','partially_paid') THEN 'reception'
    ELSE 'closed' END $$;

-- 2. Handover history (insert-only, written by trigger)
CREATE TABLE public.visit_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  from_status text,
  to_status text NOT NULL,
  from_department text,
  to_department text NOT NULL,
  handed_by uuid REFERENCES public.profiles(id),
  handed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visit_handovers_visit_idx ON public.visit_handovers (visit_id, handed_at);
GRANT SELECT ON public.visit_handovers TO authenticated;
GRANT ALL ON public.visit_handovers TO service_role;
REVOKE ALL ON public.visit_handovers FROM anon;
ALTER TABLE public.visit_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read handovers" ON public.visit_handovers FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- 3. Payment requests from OPD to Reception
CREATE SEQUENCE public.payment_request_seq;
CREATE TABLE public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  consultation_id uuid REFERENCES public.consultations(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invoiced','cancelled')),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  requested_by uuid REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  invoiced_by uuid REFERENCES public.profiles(id),
  invoiced_at timestamptz,
  cancelled_by uuid REFERENCES public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_requests_one_open_per_visit ON public.payment_requests (visit_id) WHERE status <> 'cancelled';
CREATE INDEX payment_requests_status_idx ON public.payment_requests (status, requested_at);
GRANT SELECT ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
REVOKE ALL ON public.payment_requests FROM anon;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing and opd read payment requests" ON public.payment_requests FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['administrator','receptionist','opd_clinician']::app_role[]));

CREATE TABLE public.payment_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES public.payment_requests(id),
  charge_id uuid NOT NULL REFERENCES public.service_charges(id),
  lab_request_item_id uuid REFERENCES public.lab_request_items(id),
  description text NOT NULL,
  category text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_request_items_req_idx ON public.payment_request_items (payment_request_id);
GRANT SELECT ON public.payment_request_items TO authenticated;
GRANT ALL ON public.payment_request_items TO service_role;
REVOKE ALL ON public.payment_request_items FROM anon;
ALTER TABLE public.payment_request_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing and opd read payment request items" ON public.payment_request_items FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['administrator','receptionist','opd_clinician']::app_role[]));

-- Clinicians need the price list to prepare a payment request
CREATE POLICY "clinician read charges" ON public.service_charges FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'opd_clinician'));

ALTER TABLE public.invoices ADD COLUMN payment_request_id uuid REFERENCES public.payment_requests(id);
CREATE UNIQUE INDEX invoices_one_live_per_request ON public.invoices (payment_request_id) WHERE payment_request_id IS NOT NULL AND status <> 'void';

ALTER TABLE public.billing_settings
  ADD COLUMN allow_partial_payments boolean NOT NULL DEFAULT true,
  ADD COLUMN payment_methods text[] NOT NULL DEFAULT ARRAY['cash','bank_transfer','mobile_money'];
ALTER TABLE public.billing_settings ADD CONSTRAINT billing_settings_methods_check
  CHECK (cardinality(payment_methods) >= 1 AND payment_methods <@ ARRAY['cash','mobile_money','bank_transfer','card','other']);

-- 4. Persistent department notifications
CREATE TABLE public.handover_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  kind text NOT NULL CHECK (kind IN ('new_patient','lab_request','lab_results_ready','specimen_rejected','payment_request','payment_received')),
  target_department text NOT NULL CHECK (target_department IN ('reception','opd','lab')),
  title text NOT NULL,
  detail text,
  ref_id uuid,
  lab_request_id uuid REFERENCES public.lab_requests(id),
  payment_request_id uuid REFERENCES public.payment_requests(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES public.profiles(id),
  acknowledged_at timestamptz
);
CREATE UNIQUE INDEX handover_notifications_open_once ON public.handover_notifications
  (visit_id, kind, target_department, (COALESCE(ref_id, visit_id))) WHERE acknowledged_at IS NULL;
CREATE INDEX handover_notifications_open_idx ON public.handover_notifications (target_department, created_at) WHERE acknowledged_at IS NULL;

CREATE OR REPLACE FUNCTION public.in_department(_dept text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE _dept
    WHEN 'reception' THEN public.has_any_role(auth.uid(), ARRAY['administrator','receptionist']::app_role[])
    WHEN 'opd' THEN public.has_any_role(auth.uid(), ARRAY['administrator','opd_clinician']::app_role[])
    WHEN 'lab' THEN public.has_any_role(auth.uid(), ARRAY['administrator','laboratory_technician']::app_role[])
    ELSE false END $$;

GRANT SELECT ON public.handover_notifications TO authenticated;
GRANT ALL ON public.handover_notifications TO service_role;
REVOKE ALL ON public.handover_notifications FROM anon;
ALTER TABLE public.handover_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "department reads own notifications" ON public.handover_notifications FOR SELECT TO authenticated
  USING (public.in_department(target_department));

CREATE OR REPLACE FUNCTION public.wf_notify(_visit uuid, _kind text, _target text, _ref uuid DEFAULT NULL, _lab_request uuid DEFAULT NULL, _payment_request uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v record; t text;
BEGIN
  SELECT vi.id, vi.patient_id, vi.visit_number, vi.queue_number, p.mrn INTO v
    FROM public.visits vi JOIN public.patients p ON p.id = vi.patient_id WHERE vi.id = _visit;
  IF v IS NULL THEN RETURN; END IF;
  t := CASE _kind
    WHEN 'new_patient' THEN 'NEW PATIENT REGISTERED – READY FOR CONSULTATION'
    WHEN 'lab_request' THEN 'NEW LABORATORY REQUEST – PATIENT WAITING FOR TESTING'
    WHEN 'lab_results_ready' THEN 'LABORATORY RESULTS VERIFIED – PATIENT READY FOR OPD REVIEW'
    WHEN 'specimen_rejected' THEN 'SPECIMEN REJECTED – RECOLLECTION NEEDED'
    WHEN 'payment_request' THEN 'PATIENT CONSULTATION COMPLETED – PAYMENT REQUEST RECEIVED'
    WHEN 'payment_received' THEN 'PAYMENT RECEIVED – PATIENT READY FOR VISIT CLOSURE' END;
  INSERT INTO public.handover_notifications (visit_id, patient_id, kind, target_department, title, detail, ref_id, lab_request_id, payment_request_id, created_by)
  VALUES (v.id, v.patient_id, _kind, _target, t,
          v.mrn || ' · ' || COALESCE(v.visit_number, '') || ' · Queue #' || COALESCE(v.queue_number::text, '—'),
          _ref, _lab_request, _payment_request, auth.uid())
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.wf_ack(_visit uuid, _kinds text[], _ref uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.handover_notifications SET acknowledged_by = auth.uid(), acknowledged_at = now()
   WHERE visit_id = _visit AND kind = ANY(_kinds) AND acknowledged_at IS NULL AND (_ref IS NULL OR ref_id = _ref) $$;

CREATE OR REPLACE FUNCTION public.acknowledge_notification(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n record;
BEGIN
  SELECT * INTO n FROM public.handover_notifications WHERE id = _id FOR UPDATE;
  IF n IS NULL OR NOT public.in_department(n.target_department) THEN RAISE EXCEPTION 'Notification not found'; END IF;
  IF n.acknowledged_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.handover_notifications SET acknowledged_by = auth.uid(), acknowledged_at = now() WHERE id = _id;
END $$;

-- 5. Visit rules: backend-only workflow steps
CREATE OR REPLACE FUNCTION public.visit_before()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE appt record; is_archived boolean; ok boolean;
  sys boolean := COALESCE(current_setting('app.workflow', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT archived INTO is_archived FROM public.patients WHERE id = NEW.patient_id;
    IF is_archived THEN RAISE EXCEPTION 'This patient record is archived'; END IF;
    NEW.queue_date := public.clinic_today();
    IF EXISTS (SELECT 1 FROM public.visits WHERE patient_id = NEW.patient_id AND queue_date = NEW.queue_date
               AND status IN ('waiting','in_consultation','awaiting_lab','lab_processing','ready_for_review','awaiting_payment','partially_paid','ready_to_close')) THEN
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
    NEW.visit_number := 'V-' || to_char(NEW.queue_date, 'YYMMDD') || '-' || lpad(NEW.queue_number::text, 3, '0');
    NEW.status := 'waiting';
    NEW.checked_in_by := COALESCE(auth.uid(), NEW.checked_in_by);
    NEW.checked_in_at := now();
    NEW.started_at := NULL; NEW.completed_at := NULL;
    IF length(COALESCE(NEW.reception_notes, '')) > 300 THEN RAISE EXCEPTION 'Notes must be 300 characters or fewer'; END IF;
  ELSE
    NEW.queue_number := OLD.queue_number;
    NEW.queue_date := OLD.queue_date;
    NEW.visit_number := OLD.visit_number;
    NEW.patient_id := OLD.patient_id;
    NEW.appointment_id := OLD.appointment_id;
    NEW.visit_type := OLD.visit_type;
    NEW.checked_in_by := OLD.checked_in_by;
    NEW.checked_in_at := OLD.checked_in_at;
    IF NEW.service_key IS DISTINCT FROM OLD.service_key AND OLD.status <> 'waiting' THEN
      RAISE EXCEPTION 'The service can only be changed while the patient is waiting';
    END IF;
    IF NEW.status <> OLD.status THEN
      ok := CASE OLD.status
        WHEN 'waiting' THEN NEW.status IN ('in_consultation','cancelled','no_show')
        WHEN 'in_consultation' THEN NEW.status IN ('awaiting_lab','awaiting_payment','completed','waiting')
        WHEN 'awaiting_lab' THEN NEW.status IN ('lab_processing','ready_for_review')
        WHEN 'lab_processing' THEN NEW.status IN ('ready_for_review')
        WHEN 'ready_for_review' THEN NEW.status IN ('awaiting_lab','awaiting_payment','completed')
        WHEN 'awaiting_payment' THEN NEW.status IN ('partially_paid','ready_to_close','ready_for_review','in_consultation')
        WHEN 'partially_paid' THEN NEW.status IN ('ready_to_close','awaiting_payment')
        WHEN 'ready_to_close' THEN NEW.status IN ('completed','partially_paid','awaiting_payment')
        ELSE false END;
      IF NOT ok THEN RAISE EXCEPTION 'Visit status cannot change from % to %', OLD.status, NEW.status; END IF;
      -- laboratory, payment and review steps are set only by the workflow functions, never directly
      IF NOT sys AND (NEW.status IN ('awaiting_lab','lab_processing','ready_for_review','awaiting_payment','partially_paid','ready_to_close')
                      OR OLD.status IN ('awaiting_payment','partially_paid')) THEN
        RAISE EXCEPTION 'This step is set automatically by the patient workflow';
      END IF;
      IF auth.uid() IS NOT NULL AND NOT sys THEN
        IF (NEW.status = 'in_consultation' OR (OLD.status = 'in_consultation' AND NEW.status = 'waiting'))
           AND NOT public.has_role(auth.uid(), 'opd_clinician') THEN
          RAISE EXCEPTION 'Only an OPD clinician can move a visit to this status';
        END IF;
        IF NEW.status = 'completed' AND NOT public.has_any_role(auth.uid(), ARRAY['opd_clinician','administrator']::app_role[]) THEN
          RAISE EXCEPTION 'Only an OPD clinician or administrator can close a visit';
        END IF;
      END IF;
      IF NEW.status = 'completed' THEN
        IF NOT EXISTS (SELECT 1 FROM public.consultations WHERE visit_id = NEW.id AND status = 'signed') THEN
          RAISE EXCEPTION 'Sign the consultation note before completing the visit';
        END IF;
        IF EXISTS (SELECT 1 FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id
                   WHERE r.visit_id = NEW.id AND i.status NOT IN ('verified','cancelled')) THEN
          RAISE EXCEPTION 'Laboratory tests for this visit are not finished yet';
        END IF;
        IF public.billing_enabled() AND OLD.status <> 'ready_to_close' THEN
          RAISE EXCEPTION 'Send the payment request to Reception; the visit can be closed after payment is recorded';
        END IF;
        IF EXISTS (SELECT 1 FROM public.invoices i JOIN public.invoice_balances b ON b.invoice_id = i.id
                   WHERE i.visit_id = NEW.id AND i.status = 'issued' AND b.balance > 0) THEN
          RAISE EXCEPTION 'This visit still has a balance due at Reception';
        END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.visit_after()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pr uuid;
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE public.appointments SET status = 'checked_in' WHERE id = NEW.appointment_id AND status = 'scheduled';
    ELSIF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
      UPDATE public.appointments SET status = 'completed' WHERE id = NEW.appointment_id AND status = 'checked_in';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.visit_handovers (visit_id, patient_id, from_status, to_status, from_department, to_department, handed_by)
    VALUES (NEW.id, NEW.patient_id, NULL, NEW.status, 'reception', public.visit_department(NEW.status), auth.uid());
    PERFORM public.wf_notify(NEW.id, 'new_patient', 'opd');
    RETURN NEW;
  END IF;
  -- one encounter per visit, opened when the clinician starts the consultation
  IF NEW.status = 'in_consultation' AND OLD.status <> 'in_consultation' THEN
    INSERT INTO public.consultations (visit_id, patient_id, service_key, clinician_id)
    VALUES (NEW.id, NEW.patient_id, NEW.service_key, COALESCE(auth.uid(), NEW.assigned_clinician_id))
    ON CONFLICT (visit_id) DO NOTHING;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.visit_handovers (visit_id, patient_id, from_status, to_status, from_department, to_department, handed_by)
    VALUES (NEW.id, NEW.patient_id, OLD.status, NEW.status, public.visit_department(OLD.status), public.visit_department(NEW.status), auth.uid());
    IF NEW.status <> 'waiting' THEN PERFORM public.wf_ack(NEW.id, ARRAY['new_patient']); END IF;
    IF NEW.status = 'ready_for_review' THEN PERFORM public.wf_notify(NEW.id, 'lab_results_ready', 'opd'); END IF;
    IF NEW.status <> 'ready_for_review' THEN PERFORM public.wf_ack(NEW.id, ARRAY['lab_results_ready']); END IF;
    IF NEW.status = 'awaiting_payment' THEN
      SELECT id INTO pr FROM public.payment_requests WHERE visit_id = NEW.id AND status = 'pending' ORDER BY requested_at DESC LIMIT 1;
      PERFORM public.wf_notify(NEW.id, 'payment_request', 'reception', NULL, NULL, pr);
    ELSE
      PERFORM public.wf_ack(NEW.id, ARRAY['payment_request']);
    END IF;
    IF NEW.status = 'ready_to_close' THEN PERFORM public.wf_notify(NEW.id, 'payment_received', 'opd');
    ELSE PERFORM public.wf_ack(NEW.id, ARRAY['payment_received']); END IF;
    IF NEW.status IN ('completed','cancelled','no_show') THEN
      PERFORM public.wf_ack(NEW.id, ARRAY['new_patient','lab_request','lab_results_ready','specimen_rejected','payment_request','payment_received']);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 6. Encounter rules accept the new lab-processing step
CREATE OR REPLACE FUNCTION public.consult_before()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; problems text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v FROM public.visits WHERE id = NEW.visit_id;
  IF TG_OP = 'INSERT' THEN
    IF v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
    IF v.status NOT IN ('in_consultation','awaiting_lab','lab_processing','ready_for_review') THEN
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
  IF v.status NOT IN ('in_consultation','awaiting_lab','lab_processing','ready_for_review') THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.vitals_before()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Recorded vital signs cannot be changed; record a new measurement'; END IF;
  SELECT * INTO v FROM public.visits WHERE id = NEW.visit_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF v.status NOT IN ('waiting','in_consultation','awaiting_lab','lab_processing','ready_for_review') THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.create_lab_order(_visit_id uuid, _test_ids uuid[], _priority text DEFAULT 'routine'::text, _notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_status text; v_patient uuid; req_id uuid; req_no text; dup text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'opd_clinician') THEN RAISE EXCEPTION 'Only an OPD clinician can request laboratory tests'; END IF;
  IF _test_ids IS NULL OR cardinality(_test_ids) = 0 THEN RAISE EXCEPTION 'Tick at least one test'; END IF;
  IF cardinality(_test_ids) > 60 THEN RAISE EXCEPTION 'Too many tests in one request'; END IF;
  IF _priority NOT IN ('routine','urgent') THEN RAISE EXCEPTION 'Priority must be routine or urgent'; END IF;
  IF length(COALESCE(_notes,'')) > 2000 THEN RAISE EXCEPTION 'Clinical notes are too long (max 2000 characters)'; END IF;
  SELECT status, patient_id INTO v_status, v_patient FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF v_status NOT IN ('in_consultation','awaiting_lab','lab_processing','ready_for_review') THEN RAISE EXCEPTION 'Start the consultation first'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_test_ids) t(tid) LEFT JOIN public.lab_tests l ON l.id = t.tid WHERE l.id IS NULL OR NOT l.active) THEN
    RAISE EXCEPTION 'One of the selected tests is not available';
  END IF;
  SELECT string_agg(DISTINCT lt.name, ', ') INTO dup
    FROM public.lab_request_items i
    JOIN public.lab_requests r ON r.id = i.lab_request_id
    JOIN public.lab_tests lt ON lt.id = i.lab_test_id
   WHERE r.visit_id = _visit_id AND i.lab_test_id = ANY(_test_ids) AND i.status NOT IN ('verified','cancelled');
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Already requested for this visit and not finished yet: %', dup USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.lab_requests (visit_id, patient_id, priority, clinical_notes)
    VALUES (_visit_id, v_patient, _priority, NULLIF(btrim(COALESCE(_notes,'')), ''))
    RETURNING id, request_number INTO req_id, req_no;
  INSERT INTO public.lab_request_items (lab_request_id, lab_test_id)
    SELECT req_id, tid FROM (SELECT DISTINCT unnest(_test_ids) AS tid) s;
  IF v_status NOT IN ('awaiting_lab','lab_processing') THEN
    PERFORM set_config('app.workflow', 'on', true);
    UPDATE public.visits SET status = 'awaiting_lab' WHERE id = _visit_id;
  END IF;
  RETURN jsonb_build_object('id', req_id, 'request_number', req_no);
END $function$;

-- 7. Laboratory handovers
CREATE OR REPLACE FUNCTION public.lab_request_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.wf_notify(NEW.visit_id, 'lab_request', 'lab', NEW.id, NEW.id, NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER lab_request_notify AFTER INSERT ON public.lab_requests FOR EACH ROW EXECUTE FUNCTION public.lab_request_after();

CREATE OR REPLACE FUNCTION public.accept_lab_request(_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'laboratory_technician') THEN RAISE EXCEPTION 'Only laboratory staff can accept a request'; END IF;
  SELECT * INTO r FROM public.lab_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'Laboratory request not found'; END IF;
  IF r.accepted_at IS NOT NULL THEN RETURN; END IF;
  IF r.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'This request is already finished'; END IF;
  PERFORM 1 FROM public.visits WHERE id = r.visit_id FOR UPDATE;
  UPDATE public.lab_requests SET accepted_by = auth.uid(), accepted_at = now() WHERE id = _request_id;
  PERFORM public.wf_ack(r.visit_id, ARRAY['lab_request'], r.id);
  PERFORM set_config('app.workflow', 'on', true);
  UPDATE public.visits SET status = 'lab_processing' WHERE id = r.visit_id AND status = 'awaiting_lab';
END $$;

CREATE OR REPLACE FUNCTION public.lab_item_after()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  PERFORM set_config('app.workflow', 'on', true);
  IF NEW.status NOT IN ('requested','cancelled') THEN
    -- the first specimen or result step counts as the laboratory accepting the request
    UPDATE public.lab_requests SET accepted_by = auth.uid(), accepted_at = now() WHERE id = NEW.lab_request_id AND accepted_at IS NULL;
    PERFORM public.wf_ack(vid, ARRAY['lab_request'], NEW.lab_request_id);
    UPDATE public.visits SET status = 'lab_processing' WHERE id = vid AND status = 'awaiting_lab';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id
    WHERE r.visit_id = vid AND i.status NOT IN ('verified','cancelled')
  ) THEN
    UPDATE public.visits SET status = 'ready_for_review' WHERE id = vid AND status IN ('awaiting_lab','lab_processing');
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.lab_specimen_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE vid uuid;
BEGIN
  SELECT visit_id INTO vid FROM public.lab_requests WHERE id = NEW.lab_request_id;
  IF TG_OP = 'INSERT' AND NEW.replaces_specimen_id IS NOT NULL THEN
    PERFORM public.wf_ack(vid, ARRAY['specimen_rejected'], NEW.replaces_specimen_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    PERFORM public.wf_notify(vid, 'specimen_rejected', 'lab', NEW.id, NEW.lab_request_id, NULL);
    PERFORM public.wf_notify(vid, 'specimen_rejected', 'opd', NEW.id, NEW.lab_request_id, NULL);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_specimen_notify AFTER INSERT OR UPDATE ON public.lab_specimens FOR EACH ROW EXECUTE FUNCTION public.lab_specimen_after();

-- 8. Payment request, invoice and payment handovers
CREATE OR REPLACE FUNCTION public.submit_payment_request(_visit_id uuid, _items jsonb, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v record; c_id uuid; req_id uuid; req_no text; n int; bad int; tot numeric; unpriced text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'opd_clinician') THEN RAISE EXCEPTION 'Only an OPD clinician can send a payment request'; END IF;
  IF NOT public.billing_enabled() THEN RAISE EXCEPTION 'Billing is not switched on. The administrator must configure and approve prices first.'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN RAISE EXCEPTION 'Choose the services to charge'; END IF;
  IF jsonb_array_length(_items) > 50 THEN RAISE EXCEPTION 'Too many items in one payment request'; END IF;
  IF length(COALESCE(_notes, '')) > 1000 THEN RAISE EXCEPTION 'Notes must be 1000 characters or fewer'; END IF;
  SELECT * INTO v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.payment_requests WHERE visit_id = _visit_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'A payment request was already sent for this visit' USING ERRCODE = '23505';
  END IF;
  IF v.status NOT IN ('in_consultation','ready_for_review') THEN
    RAISE EXCEPTION 'A payment request can be sent only when the consultation is finished and no laboratory tests are pending';
  END IF;
  SELECT id INTO c_id FROM public.consultations WHERE visit_id = _visit_id AND status = 'signed';
  IF c_id IS NULL THEN RAISE EXCEPTION 'Sign the consultation note before sending the payment request'; END IF;
  IF EXISTS (SELECT 1 FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id
             WHERE r.visit_id = _visit_id AND i.status NOT IN ('verified','cancelled')) THEN
    RAISE EXCEPTION 'Some laboratory tests for this visit are not finished yet';
  END IF;
  SELECT count(*) INTO bad FROM jsonb_array_elements(_items) x
    LEFT JOIN public.service_charges s ON s.id::text = x->>'charge_id'
   WHERE s.id IS NULL OR NOT s.active OR s.lab_test_id IS NOT NULL
      OR COALESCE(x->>'quantity', '1') !~ '^\d{1,4}$' OR COALESCE((x->>'quantity')::int, 1) NOT BETWEEN 1 AND 1000;
  IF bad > 0 THEN RAISE EXCEPTION 'One of the selected charges is not available (laboratory test charges are added automatically)'; END IF;

  req_no := 'PR-' || to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'YYMMDD') || '-' || lpad(nextval('public.payment_request_seq')::text, 5, '0');
  INSERT INTO public.payment_requests (request_number, visit_id, patient_id, consultation_id, notes, requested_by)
  VALUES (req_no, _visit_id, v.patient_id, c_id, NULLIF(btrim(COALESCE(_notes, '')), ''), auth.uid())
  RETURNING id INTO req_id;
  INSERT INTO public.payment_request_items (payment_request_id, charge_id, description, category, quantity, unit_price)
    SELECT req_id, s.id, s.name, s.category, COALESCE((x->>'quantity')::int, 1), s.price
      FROM jsonb_array_elements(_items) x JOIN public.service_charges s ON s.id::text = x->>'charge_id';
  -- laboratory charges for every verified test that has a price in the administrator's list
  INSERT INTO public.payment_request_items (payment_request_id, charge_id, lab_request_item_id, description, category, quantity, unit_price)
    SELECT req_id, s.id, i.id, s.name, s.category, 1, s.price
      FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id
      JOIN LATERAL (SELECT * FROM public.service_charges sc WHERE sc.lab_test_id = i.lab_test_id AND sc.active ORDER BY sc.display_order, sc.name LIMIT 1) s ON true
     WHERE r.visit_id = _visit_id AND i.status = 'verified';
  SELECT string_agg(t.name, ', ') INTO unpriced
    FROM public.lab_request_items i JOIN public.lab_requests r ON r.id = i.lab_request_id JOIN public.lab_tests t ON t.id = i.lab_test_id
   WHERE r.visit_id = _visit_id AND i.status = 'verified'
     AND NOT EXISTS (SELECT 1 FROM public.service_charges sc WHERE sc.lab_test_id = i.lab_test_id AND sc.active);
  SELECT count(*), COALESCE(sum(line_total), 0) INTO n, tot FROM public.payment_request_items WHERE payment_request_id = req_id;
  IF n = 0 THEN RAISE EXCEPTION 'Choose at least one service charge from the price list'; END IF;
  PERFORM set_config('app.workflow', 'on', true);
  UPDATE public.visits SET status = 'awaiting_payment' WHERE id = _visit_id;
  RETURN jsonb_build_object('id', req_id, 'request_number', req_no, 'total', tot, 'items', n, 'unpriced_tests', unpriced);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_payment_request(_request_id uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['opd_clinician','administrator']::app_role[]) THEN RAISE EXCEPTION 'Only an OPD clinician or administrator can withdraw a payment request'; END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN RAISE EXCEPTION 'Give a reason of at least 5 characters'; END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'Payment request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Reception already made an invoice for this request; the administrator must void it first'; END IF;
  PERFORM 1 FROM public.visits WHERE id = r.visit_id FOR UPDATE;
  UPDATE public.payment_requests SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = btrim(_reason), updated_at = now() WHERE id = _request_id;
  PERFORM set_config('app.workflow', 'on', true);
  UPDATE public.visits SET status = CASE WHEN EXISTS (SELECT 1 FROM public.lab_requests WHERE visit_id = r.visit_id) THEN 'ready_for_review' ELSE 'in_consultation' END
   WHERE id = r.visit_id AND status = 'awaiting_payment';
END $$;

CREATE OR REPLACE FUNCTION public.sync_visit_payment(_invoice uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i record; b record; vs text; target text;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = _invoice;
  IF i IS NULL OR i.payment_request_id IS NULL OR i.visit_id IS NULL THEN RETURN; END IF;
  SELECT status INTO vs FROM public.visits WHERE id = i.visit_id FOR UPDATE;
  IF vs NOT IN ('awaiting_payment','partially_paid','ready_to_close') THEN RETURN; END IF;
  IF i.status = 'void' THEN target := 'awaiting_payment';
  ELSIF i.status = 'draft' THEN RETURN;
  ELSE
    SELECT * INTO b FROM public.invoice_balances WHERE invoice_id = _invoice;
    target := CASE WHEN b.balance <= 0 THEN 'ready_to_close' WHEN b.paid > 0 THEN 'partially_paid' ELSE 'awaiting_payment' END;
  END IF;
  IF target <> vs THEN
    PERFORM set_config('app.workflow', 'on', true);
    UPDATE public.visits SET status = target WHERE id = i.visit_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_request(_request_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; inv uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['administrator','receptionist']::app_role[]) THEN RAISE EXCEPTION 'Only Reception or an administrator can create invoices'; END IF;
  IF NOT public.billing_enabled() THEN RAISE EXCEPTION 'Billing is not switched on'; END IF;
  SELECT * INTO r FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'Payment request not found'; END IF;
  IF r.status = 'cancelled' THEN RAISE EXCEPTION 'This payment request was withdrawn by OPD'; END IF;
  IF r.status = 'invoiced' THEN
    SELECT id INTO inv FROM public.invoices WHERE payment_request_id = r.id AND status <> 'void' LIMIT 1;
    IF inv IS NOT NULL THEN RETURN inv; END IF;
  END IF;
  PERFORM set_config('app.workflow', 'on', true);
  INSERT INTO public.invoices (patient_id, visit_id, payment_request_id, notes)
  VALUES (r.patient_id, r.visit_id, r.id, 'From OPD payment request ' || r.request_number)
  RETURNING id INTO inv;
  INSERT INTO public.invoice_items (invoice_id, charge_id, description, quantity, unit_price)
    SELECT inv, charge_id, description, quantity, unit_price FROM public.payment_request_items WHERE payment_request_id = r.id ORDER BY created_at;
  UPDATE public.invoices SET status = 'issued' WHERE id = inv;
  UPDATE public.payment_requests SET status = 'invoiced', invoiced_by = auth.uid(), invoiced_at = now(), updated_at = now() WHERE id = r.id;
  PERFORM public.wf_ack(r.visit_id, ARRAY['payment_request']);
  PERFORM public.sync_visit_payment(inv);
  RETURN inv;
END $$;

CREATE OR REPLACE FUNCTION public.invoice_before()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_patient uuid; v_archived boolean;
BEGIN
  IF NOT public.billing_enabled() THEN RAISE EXCEPTION 'Billing is not switched on. The administrator must configure and approve it first.'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT archived INTO v_archived FROM public.patients WHERE id = NEW.patient_id;
    IF v_archived IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;
    IF v_archived THEN RAISE EXCEPTION 'This patient record is archived'; END IF;
    IF NEW.visit_id IS NOT NULL THEN
      SELECT patient_id INTO v_patient FROM public.visits WHERE id = NEW.visit_id;
      IF v_patient IS DISTINCT FROM NEW.patient_id THEN RAISE EXCEPTION 'The visit belongs to a different patient'; END IF;
    END IF;
    IF NEW.payment_request_id IS NOT NULL AND COALESCE(current_setting('app.workflow', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Create this invoice from the OPD payment request';
    END IF;
    IF NEW.payment_request_id IS NULL AND NEW.visit_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.payment_requests WHERE visit_id = NEW.visit_id AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'This visit has a payment request from OPD; create the invoice from it';
    END IF;
    NEW.invoice_number := 'INV-' || to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'YYMMDD') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0');
    NEW.status := 'draft';
    NEW.currency := (SELECT currency FROM public.billing_settings WHERE id = 1);
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.issued_by := NULL; NEW.issued_at := NULL; NEW.voided_by := NULL; NEW.voided_at := NULL; NEW.void_reason := NULL;
    NEW.notes := NULLIF(btrim(COALESCE(NEW.notes, '')), '');
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'A void invoice cannot be changed'; END IF;
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.payment_request_id IS DISTINCT FROM OLD.payment_request_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Invoice number, patient, visit, payment request and currency cannot be changed';
  END IF;
  IF OLD.status = 'issued' AND NEW.notes IS DISTINCT FROM OLD.notes THEN RAISE EXCEPTION 'An issued invoice cannot be edited'; END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
      IF NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = OLD.id) THEN RAISE EXCEPTION 'Add at least one item before issuing'; END IF;
      NEW.issued_by := auth.uid(); NEW.issued_at := now();
    ELSIF NEW.status = 'void' THEN
      IF NOT public.has_role(auth.uid(), 'administrator') THEN RAISE EXCEPTION 'Only an administrator can void an invoice'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.billing_adjustments WHERE invoice_id = OLD.id AND kind = 'void') THEN
        RAISE EXCEPTION 'Void an invoice with the Void action (a reason is required)';
      END IF;
      NEW.voided_by := auth.uid(); NEW.voided_at := now();
    ELSE
      RAISE EXCEPTION 'Invoice cannot move from % to %', OLD.status, NEW.status;
    END IF;
  ELSE
    NEW.issued_by := OLD.issued_by; NEW.issued_at := OLD.issued_at;
    NEW.voided_by := OLD.voided_by; NEW.voided_at := OLD.voided_at; NEW.void_reason := OLD.void_reason;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.invoice_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'void' AND OLD.status <> 'void' AND NEW.payment_request_id IS NOT NULL THEN
    -- the OPD request goes back to Reception so a corrected invoice can be made
    UPDATE public.payment_requests SET status = 'pending', invoiced_by = NULL, invoiced_at = NULL, updated_at = now()
     WHERE id = NEW.payment_request_id AND status = 'invoiced';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN PERFORM public.sync_visit_payment(NEW.id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_workflow AFTER UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoice_after();

CREATE OR REPLACE FUNCTION public.payment_before()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text; v_balance numeric; s record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Payments cannot be changed or deleted. An administrator can reverse a payment with a reason.'; END IF;
  IF NOT public.billing_enabled() THEN RAISE EXCEPTION 'Billing is not switched on'; END IF;
  SELECT * INTO s FROM public.billing_settings WHERE id = 1;
  IF NOT (NEW.method = ANY(s.payment_methods)) THEN RAISE EXCEPTION 'This payment method is not accepted by the clinic'; END IF;
  SELECT status INTO v_status FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'issued' THEN RAISE EXCEPTION 'Payments can only be taken on an issued invoice'; END IF;
  v_balance := public.invoice_balance(NEW.invoice_id);
  IF NEW.amount > v_balance THEN RAISE EXCEPTION 'Payment (%) is more than the balance due (%)', NEW.amount, v_balance; END IF;
  IF NOT s.allow_partial_payments AND NEW.amount <> v_balance THEN
    RAISE EXCEPTION 'Partial payments are switched off; the full balance (%) must be paid', v_balance;
  END IF;
  NEW.reference := NULLIF(btrim(COALESCE(NEW.reference, '')), '');
  NEW.receipt_number := 'RCP-' || to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'YYMMDD') || '-' || lpad(nextval('public.receipt_seq')::text, 5, '0');
  NEW.received_by := auth.uid();
  NEW.received_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.billing_money_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.sync_visit_payment(NEW.invoice_id);
  RETURN NEW;
END $$;
CREATE TRIGGER payment_workflow AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.billing_money_after();
CREATE TRIGGER adjustment_workflow AFTER INSERT ON public.billing_adjustments FOR EACH ROW EXECUTE FUNCTION public.billing_money_after();

-- 9. Admin summary counts the new steps
CREATE OR REPLACE FUNCTION public.report_admin_summary(_day date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE d date := COALESCE(_day, public.clinic_today()); res jsonb;
BEGIN
  PERFORM public.report_guard(d, d);
  SELECT jsonb_build_object(
    'day', d,
    'total_patients', (SELECT count(*) FROM patients WHERE NOT archived),
    'archived_patients', (SELECT count(*) FROM patients WHERE archived),
    'new_registrations', (SELECT count(*) FROM patients WHERE public.clinic_date(created_at) = d),
    'opd_visits', (SELECT count(*) FROM visits WHERE queue_date = d AND status NOT IN ('cancelled','no_show')),
    'waiting', (SELECT count(*) FROM visits WHERE queue_date = d AND status = 'waiting'),
    'in_clinic', (SELECT count(*) FROM visits WHERE queue_date = d AND status IN ('in_consultation','awaiting_lab','lab_processing','ready_for_review','awaiting_payment','partially_paid','ready_to_close')),
    'completed_visits', (SELECT count(*) FROM visits WHERE queue_date = d AND status = 'completed'),
    'signed_consultations', (SELECT count(*) FROM consultations WHERE status = 'signed' AND public.clinic_date(signed_at) = d),
    'lab_requests', (SELECT count(*) FROM lab_requests WHERE public.clinic_date(created_at) = d),
    'lab_tests_requested', (SELECT count(*) FROM lab_request_items i JOIN lab_requests r ON r.id = i.lab_request_id WHERE public.clinic_date(r.created_at) = d),
    'lab_processing', (SELECT count(*) FROM lab_request_items WHERE status IN ('requested','collected','received','processing','entered','rejected')),
    'awaiting_verification', (SELECT count(*) FROM lab_request_items WHERE status = 'awaiting_verification'),
    'verified_results', (SELECT count(*) FROM lab_request_items WHERE status = 'verified' AND public.clinic_date(verified_at) = d),
    'by_service', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', s.key, 'name', s.name,
               'visits', (SELECT count(*) FROM visits v WHERE v.service_key = s.key AND v.queue_date = d AND v.status NOT IN ('cancelled','no_show')),
               'completed', (SELECT count(*) FROM visits v WHERE v.service_key = s.key AND v.queue_date = d AND v.status = 'completed'))
             ORDER BY s.display_order)
        FROM service_categories s WHERE s.active), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $function$;

-- 10. Audit and function access
CREATE TRIGGER payment_requests_audit AFTER INSERT OR UPDATE OR DELETE ON public.payment_requests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER payment_request_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.payment_request_items FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER handover_notifications_audit AFTER UPDATE ON public.handover_notifications FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

REVOKE EXECUTE ON FUNCTION public.wf_notify(uuid, text, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wf_ack(uuid, text[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_visit_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lab_request_after() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lab_specimen_after() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoice_after() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_money_after() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.in_department(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.acknowledge_notification(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_lab_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_payment_request(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_payment_request(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_invoice_from_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.in_department(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_lab_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment_request(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_payment_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_request(uuid) TO authenticated;

-- 11. Live updates between departments (rows still filtered by each table's access rules)
ALTER PUBLICATION supabase_realtime ADD TABLE public.visits, public.lab_requests, public.lab_request_items, public.lab_specimens,
  public.appointments, public.handover_notifications, public.payment_requests, public.invoices, public.payments;