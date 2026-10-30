
-- ===== PATIENTS: new demographic fields, archive, CL-000001 numbering =====
ALTER TABLE public.patients
  ADD COLUMN region text,
  ADD COLUMN town text,
  ADD COLUMN dob_estimated boolean NOT NULL DEFAULT false,
  ADD COLUMN estimated_age integer,
  ADD COLUMN estimated_age_unit text CHECK (estimated_age_unit IN ('years','months','days')),
  ADD COLUMN guardian_name text,
  ADD COLUMN guardian_relationship text,
  ADD COLUMN guardian_phone text,
  ADD COLUMN correction_note text,
  ADD COLUMN archived boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_reason text,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid;
ALTER TABLE public.patients ALTER COLUMN last_name SET DEFAULT '';

UPDATE public.patients SET town = woreda WHERE town IS NULL AND woreda IS NOT NULL;
COMMENT ON COLUMN public.patients.woreda IS 'DEPRECATED: replaced by town';
COMMENT ON COLUMN public.patients.middle_name IS 'Father''s name (required)';
COMMENT ON COLUMN public.patients.last_name IS 'Grandfather''s name (optional; empty string when not given)';

-- Renumber existing fictional development records to the CL-000001 format
ALTER TABLE public.patients DISABLE TRIGGER patients_mrn;
UPDATE public.patients SET mrn = 'CL-' || lpad(substring(mrn from '(\d+)$'), 6, '0') WHERE mrn NOT LIKE 'CL-%';
ALTER TABLE public.patients ENABLE TRIGGER patients_mrn;
ALTER TABLE public.patients ALTER COLUMN mrn SET NOT NULL;

CREATE OR REPLACE FUNCTION public.clinic_today()
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date
$$;
GRANT EXECUTE ON FUNCTION public.clinic_today() TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_mrn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE demographics_changed boolean;
BEGIN
  -- normalise text
  NEW.first_name := btrim(COALESCE(NEW.first_name, ''));
  NEW.middle_name := NULLIF(btrim(COALESCE(NEW.middle_name, '')), '');
  NEW.last_name := btrim(COALESCE(NEW.last_name, ''));
  NEW.phone := NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '[\s-]', '', 'g'), '');
  NEW.guardian_phone := NULLIF(regexp_replace(COALESCE(NEW.guardian_phone, ''), '[\s-]', '', 'g'), '');

  IF NEW.first_name = '' THEN RAISE EXCEPTION 'First name is required'; END IF;
  IF NEW.middle_name IS NULL THEN RAISE EXCEPTION 'Father''s name is required'; END IF;
  IF length(NEW.first_name) > 60 OR length(NEW.middle_name) > 60 OR length(NEW.last_name) > 60 THEN
    RAISE EXCEPTION 'Names must be 60 characters or fewer';
  END IF;
  IF NEW.phone IS NOT NULL AND NEW.phone !~ '^\+?[0-9]{9,13}$' THEN RAISE EXCEPTION 'Phone number is not valid'; END IF;
  IF NEW.guardian_phone IS NOT NULL AND NEW.guardian_phone !~ '^\+?[0-9]{9,13}$' THEN RAISE EXCEPTION 'Guardian phone number is not valid'; END IF;

  IF NEW.dob_estimated THEN
    IF NEW.estimated_age IS NULL OR NEW.estimated_age_unit IS NULL OR NEW.estimated_age < 0 OR NEW.estimated_age > 130 THEN
      RAISE EXCEPTION 'Enter an estimated age and its unit';
    END IF;
    -- only recompute when the estimate itself changed, so the age keeps growing over time
    IF TG_OP = 'INSERT' OR NEW.estimated_age IS DISTINCT FROM OLD.estimated_age
       OR NEW.estimated_age_unit IS DISTINCT FROM OLD.estimated_age_unit OR NOT OLD.dob_estimated THEN
      NEW.date_of_birth := public.clinic_today() - (NEW.estimated_age || ' ' || NEW.estimated_age_unit)::interval;
    END IF;
  ELSE
    NEW.estimated_age := NULL; NEW.estimated_age_unit := NULL;
  END IF;
  IF NEW.date_of_birth IS NULL THEN RAISE EXCEPTION 'Enter the date of birth or an estimated age'; END IF;
  IF NEW.date_of_birth > public.clinic_today() THEN RAISE EXCEPTION 'Date of birth cannot be in the future'; END IF;
  IF NEW.date_of_birth < public.clinic_today() - interval '130 years' THEN RAISE EXCEPTION 'Date of birth is not valid'; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.mrn := 'CL-' || lpad(nextval('public.patient_mrn_seq')::text, 6, '0');
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.created_at := now();
    NEW.archived := false; NEW.archived_reason := NULL; NEW.archived_at := NULL; NEW.archived_by := NULL;
    NEW.correction_note := NULL;
  ELSE
    -- patient number, registration date and registering staff are immutable
    NEW.mrn := OLD.mrn;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;

    IF NEW.archived IS DISTINCT FROM OLD.archived THEN
      IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Only the administrator can archive or restore a patient record';
      END IF;
      IF NEW.archived THEN
        IF btrim(COALESCE(NEW.archived_reason, '')) = '' THEN RAISE EXCEPTION 'A reason is required to archive a record'; END IF;
        NEW.archived_at := now(); NEW.archived_by := auth.uid();
      ELSE
        NEW.archived_reason := NULL; NEW.archived_at := NULL; NEW.archived_by := NULL;
      END IF;
    ELSE
      NEW.archived_reason := OLD.archived_reason; NEW.archived_at := OLD.archived_at; NEW.archived_by := OLD.archived_by;
    END IF;

    demographics_changed := (NEW.first_name, NEW.middle_name, NEW.last_name, NEW.sex, NEW.date_of_birth, NEW.dob_estimated,
      NEW.phone, NEW.region, NEW.town, NEW.kebele, NEW.address, NEW.guardian_name, NEW.guardian_relationship, NEW.guardian_phone,
      NEW.emergency_contact_name, NEW.emergency_contact_phone, NEW.allergies)
      IS DISTINCT FROM (OLD.first_name, OLD.middle_name, OLD.last_name, OLD.sex, OLD.date_of_birth, OLD.dob_estimated,
      OLD.phone, OLD.region, OLD.town, OLD.kebele, OLD.address, OLD.guardian_name, OLD.guardian_relationship, OLD.guardian_phone,
      OLD.emergency_contact_name, OLD.emergency_contact_phone, OLD.allergies);
    IF demographics_changed AND auth.uid() IS NOT NULL
       AND (btrim(COALESCE(NEW.correction_note, '')) = '' OR NEW.correction_note IS NOT DISTINCT FROM OLD.correction_note) THEN
      RAISE EXCEPTION 'Give a reason for this correction';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE INDEX IF NOT EXISTS patients_phone_idx ON public.patients (phone);
CREATE INDEX IF NOT EXISTS patients_names_idx ON public.patients (lower(first_name), lower(middle_name));
CREATE INDEX IF NOT EXISTS patients_created_idx ON public.patients (created_at DESC);

-- Possible-duplicate finder (runs with the caller's permissions)
CREATE OR REPLACE FUNCTION public.find_possible_duplicates(_first text, _father text, _phone text, _dob date)
RETURNS TABLE (id uuid, mrn text, first_name text, middle_name text, last_name text, sex text,
               date_of_birth date, phone text, town text, reason text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p.id, p.mrn, p.first_name, p.middle_name, p.last_name, p.sex, p.date_of_birth, p.phone, p.town,
    concat_ws(', ',
      CASE WHEN length(regexp_replace(COALESCE(_phone,''), '\D', '', 'g')) >= 9
            AND right(regexp_replace(COALESCE(p.phone,''), '\D', '', 'g'), 9) = right(regexp_replace(_phone, '\D', '', 'g'), 9)
           THEN 'same phone number' END,
      CASE WHEN lower(p.first_name) = lower(btrim(_first)) AND lower(COALESCE(p.middle_name,'')) = lower(btrim(COALESCE(_father,'')))
           THEN 'same first and father''s name' END,
      CASE WHEN _dob IS NOT NULL AND p.date_of_birth = _dob AND lower(p.first_name) = lower(btrim(_first))
           THEN 'same first name and date of birth' END
    ) AS reason
  FROM public.patients p
  WHERE NOT p.archived AND (
    (length(regexp_replace(COALESCE(_phone,''), '\D', '', 'g')) >= 9
      AND right(regexp_replace(COALESCE(p.phone,''), '\D', '', 'g'), 9) = right(regexp_replace(_phone, '\D', '', 'g'), 9))
    OR (lower(p.first_name) = lower(btrim(_first)) AND lower(COALESCE(p.middle_name,'')) = lower(btrim(COALESCE(_father,''))))
    OR (_dob IS NOT NULL AND p.date_of_birth = _dob AND lower(p.first_name) = lower(btrim(_first)))
  )
  ORDER BY p.created_at DESC
  LIMIT 10
$$;
GRANT EXECUTE ON FUNCTION public.find_possible_duplicates(text, text, text, date) TO authenticated;

-- ===== APPOINTMENTS =====
ALTER TABLE public.appointments DROP CONSTRAINT appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('scheduled','checked_in','cancelled','no_show','completed'));
ALTER TABLE public.appointments
  ADD COLUMN cancel_reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_by uuid;
CREATE INDEX IF NOT EXISTS appointments_time_idx ON public.appointments (scheduled_at);
-- one active appointment per patient per clinic day
CREATE UNIQUE INDEX appointments_one_per_day ON public.appointments
  (patient_id, ((scheduled_at AT TIME ZONE 'Africa/Addis_Ababa')::date)) WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION public.appointment_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_archived boolean;
BEGIN
  IF length(COALESCE(NEW.reason, '')) > 300 THEN RAISE EXCEPTION 'Reason must be 300 characters or fewer'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT archived INTO is_archived FROM public.patients WHERE id = NEW.patient_id;
    IF is_archived THEN RAISE EXCEPTION 'This patient record is archived'; END IF;
    NEW.status := 'scheduled';
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.created_at := now();
    IF NEW.scheduled_at < now() - interval '15 minutes' THEN RAISE EXCEPTION 'Appointment time is in the past'; END IF;
  ELSE
    NEW.patient_id := OLD.patient_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF OLD.status <> 'scheduled' AND (NEW.scheduled_at, NEW.service_key, NEW.reason) IS DISTINCT FROM (OLD.scheduled_at, OLD.service_key, OLD.reason) THEN
      RAISE EXCEPTION 'Only scheduled appointments can be changed';
    END IF;
    IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at AND NEW.scheduled_at < now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'Appointment time is in the past';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'scheduled' AND NEW.status IN ('checked_in','cancelled','no_show')) OR
        (OLD.status = 'checked_in' AND NEW.status = 'completed')
      ) THEN
        RAISE EXCEPTION 'Appointment status cannot change from % to %', OLD.status, NEW.status;
      END IF;
      IF NEW.status = 'checked_in' AND NOT EXISTS (SELECT 1 FROM public.visits WHERE appointment_id = NEW.id) THEN
        RAISE EXCEPTION 'Use Check in to add the patient to the queue';
      END IF;
      IF NEW.status = 'completed' AND NOT EXISTS (SELECT 1 FROM public.visits WHERE appointment_id = NEW.id AND status = 'completed') THEN
        RAISE EXCEPTION 'An appointment is completed when its visit is completed';
      END IF;
      IF NEW.status = 'cancelled' AND btrim(COALESCE(NEW.cancel_reason, '')) = '' THEN
        RAISE EXCEPTION 'A cancellation reason is required';
      END IF;
    END IF;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_before BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointment_before();

-- ===== VISITS / QUEUE =====
ALTER TABLE public.visits ALTER COLUMN queue_date SET DEFAULT ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date);
ALTER TABLE public.visits ADD CONSTRAINT visits_queue_number_unique UNIQUE (queue_date, queue_number);
CREATE UNIQUE INDEX visits_one_per_appointment ON public.visits (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE UNIQUE INDEX visits_one_active_per_patient_day ON public.visits (patient_id, queue_date)
  WHERE status IN ('waiting','in_consultation','awaiting_lab');

CREATE OR REPLACE FUNCTION public.visit_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE appt record; is_archived boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT archived INTO is_archived FROM public.patients WHERE id = NEW.patient_id;
    IF is_archived THEN RAISE EXCEPTION 'This patient record is archived'; END IF;
    NEW.queue_date := public.clinic_today();
    IF EXISTS (SELECT 1 FROM public.visits WHERE patient_id = NEW.patient_id AND queue_date = NEW.queue_date
               AND status IN ('waiting','in_consultation','awaiting_lab')) THEN
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
    -- check-in facts are immutable
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
        (OLD.status = 'awaiting_lab' AND NEW.status IN ('in_consultation','completed'))
      ) THEN
        RAISE EXCEPTION 'Visit status cannot change from % to %', OLD.status, NEW.status;
      END IF;
      IF NEW.status = 'in_consultation' AND OLD.started_at IS NULL THEN
        NEW.started_at := now();
        NEW.assigned_clinician_id := COALESCE(NEW.assigned_clinician_id, auth.uid());
      END IF;
      IF NEW.status = 'completed' THEN NEW.completed_at := now(); END IF;
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
  RETURN NEW;
END $$;
CREATE TRIGGER visits_after AFTER INSERT OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visit_after();

ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
