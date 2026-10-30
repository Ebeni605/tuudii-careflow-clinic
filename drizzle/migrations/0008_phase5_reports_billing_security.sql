-- =====================================================================
-- Phase 5: integration guards, admin reports, optional billing, security
-- =====================================================================

-- ---------- A. Lab orders: no duplicate open tests, serialised per visit ----------
CREATE OR REPLACE FUNCTION public.create_lab_order(_visit_id uuid, _test_ids uuid[], _priority text DEFAULT 'routine'::text, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_status text; v_patient uuid; req_id uuid; req_no text; dup text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'clinician') THEN RAISE EXCEPTION 'Only an OPD clinician can request laboratory tests'; END IF;
  IF _test_ids IS NULL OR cardinality(_test_ids) = 0 THEN RAISE EXCEPTION 'Tick at least one test'; END IF;
  IF cardinality(_test_ids) > 60 THEN RAISE EXCEPTION 'Too many tests in one request'; END IF;
  IF _priority NOT IN ('routine','urgent') THEN RAISE EXCEPTION 'Priority must be routine or urgent'; END IF;
  IF length(COALESCE(_notes,'')) > 2000 THEN RAISE EXCEPTION 'Clinical notes are too long (max 2000 characters)'; END IF;
  -- Lock the visit so two clicks / two clinicians cannot create the same order at the same moment
  SELECT status, patient_id INTO v_status, v_patient FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF v_status NOT IN ('in_consultation','awaiting_lab','ready_for_review') THEN RAISE EXCEPTION 'Start the consultation first'; END IF;
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
  IF v_status <> 'awaiting_lab' THEN
    UPDATE public.visits SET status = 'awaiting_lab' WHERE id = _visit_id;
  END IF;
  RETURN jsonb_build_object('id', req_id, 'request_number', req_no);
END $function$;

-- ---------- B. Reports (administrator only, SECURITY INVOKER so RLS still applies) ----------
CREATE OR REPLACE FUNCTION public.clinic_date(_ts timestamptz) RETURNS date
  LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT (_ts AT TIME ZONE 'Africa/Addis_Ababa')::date $$;

CREATE OR REPLACE FUNCTION public.report_guard(_from date, _to date) RETURNS void
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can view reports' USING ERRCODE = '42501';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF _to - _from > 731 THEN RAISE EXCEPTION 'Date range is limited to two years'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.age_band(_dob date, _on date) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _dob IS NULL THEN 'Unknown'
    WHEN date_part('year', age(_on, _dob)) < 1 THEN 'Under 1'
    WHEN date_part('year', age(_on, _dob)) < 5 THEN '1–4'
    WHEN date_part('year', age(_on, _dob)) < 15 THEN '5–14'
    WHEN date_part('year', age(_on, _dob)) < 25 THEN '15–24'
    WHEN date_part('year', age(_on, _dob)) < 45 THEN '25–44'
    WHEN date_part('year', age(_on, _dob)) < 65 THEN '45–64'
    ELSE '65+' END
$$;

-- Management dashboard numbers for one clinic day
CREATE OR REPLACE FUNCTION public.report_admin_summary(_day date DEFAULT NULL) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
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
    'in_clinic', (SELECT count(*) FROM visits WHERE queue_date = d AND status IN ('in_consultation','awaiting_lab','ready_for_review')),
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
END $$;

-- 1. Patient registrations (no names / phones; patient number only)
CREATE OR REPLACE FUNCTION public.report_registrations(_from date, _to date, _limit int DEFAULT 50, _offset int DEFAULT 0) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  WITH p AS (
    SELECT id, mrn, sex, region, town, created_by, created_at, archived,
           public.clinic_date(created_at) AS day,
           public.age_band(date_of_birth, public.clinic_date(created_at)) AS band
      FROM patients WHERE public.clinic_date(created_at) BETWEEN _from AND _to
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM p),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'count', n) ORDER BY day) FROM (SELECT day, count(*) n FROM p GROUP BY day) x), '[]'),
    'by_sex', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', sex, 'count', n) ORDER BY n DESC) FROM (SELECT sex, count(*) n FROM p GROUP BY sex) x), '[]'),
    'by_age', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', band, 'count', n) ORDER BY ord) FROM (
        SELECT band, count(*) n, array_position(ARRAY['Under 1','1–4','5–14','15–24','25–44','45–64','65+','Unknown'], band) ord FROM p GROUP BY band) x), '[]'),
    'by_region', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', r, 'count', n) ORDER BY n DESC) FROM (
        SELECT COALESCE(NULLIF(btrim(region),''),'Not recorded') r, count(*) n FROM p GROUP BY 1) x), '[]'),
    'rows', COALESCE((SELECT jsonb_agg(row_to_json(x) ORDER BY x.registered_at DESC) FROM (
        SELECT p.mrn, p.created_at AS registered_at, p.sex, p.band AS age_band, COALESCE(NULLIF(btrim(p.region),''), '—') AS region,
               COALESCE(pr.full_name, '—') AS registered_by, p.archived
          FROM p LEFT JOIN profiles pr ON pr.id = p.created_by
         ORDER BY p.created_at DESC LIMIT LEAST(GREATEST(_limit,1),500) OFFSET GREATEST(_offset,0)) x), '[]')
  ) INTO res;
  RETURN res;
END $$;

-- 2. OPD attendance by day or month
CREATE OR REPLACE FUNCTION public.report_opd_attendance(_from date, _to date, _group text DEFAULT 'day') RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  IF _group NOT IN ('day','month') THEN RAISE EXCEPTION 'Group by day or month'; END IF;
  WITH v AS (
    SELECT v.*, CASE WHEN _group = 'month' THEN date_trunc('month', v.queue_date)::date ELSE v.queue_date END AS period,
           NOT EXISTS (SELECT 1 FROM visits e WHERE e.patient_id = v.patient_id AND e.status NOT IN ('cancelled','no_show')
                        AND (e.queue_date < v.queue_date OR (e.queue_date = v.queue_date AND e.checked_in_at < v.checked_in_at))) AS first_visit
      FROM visits v WHERE v.queue_date BETWEEN _from AND _to
  ), agg AS (
    SELECT period,
      count(*) FILTER (WHERE status NOT IN ('cancelled','no_show')) AS attended,
      count(*) FILTER (WHERE status NOT IN ('cancelled','no_show') AND first_visit) AS new_patients,
      count(*) FILTER (WHERE status NOT IN ('cancelled','no_show') AND NOT first_visit) AS repeat_patients,
      count(*) FILTER (WHERE status NOT IN ('cancelled','no_show') AND visit_type = 'walk_in') AS walk_in,
      count(*) FILTER (WHERE status NOT IN ('cancelled','no_show') AND visit_type = 'appointment') AS by_appointment,
      count(*) FILTER (WHERE status = 'completed') AS completed,
      count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      count(*) FILTER (WHERE status = 'no_show') AS no_show
    FROM v GROUP BY period
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(row_to_json(agg) ORDER BY period) FROM agg), '[]'),
    'totals', (SELECT jsonb_build_object('attended', COALESCE(sum(attended),0), 'new_patients', COALESCE(sum(new_patients),0),
                 'repeat_patients', COALESCE(sum(repeat_patients),0), 'walk_in', COALESCE(sum(walk_in),0),
                 'by_appointment', COALESCE(sum(by_appointment),0), 'completed', COALESCE(sum(completed),0),
                 'cancelled', COALESCE(sum(cancelled),0), 'no_show', COALESCE(sum(no_show),0)) FROM agg)
  ) INTO res;
  RETURN res;
END $$;

-- 3. Clinical services utilisation
CREATE OR REPLACE FUNCTION public.report_service_utilization(_from date, _to date) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.display_order), '[]') INTO res FROM (
    SELECT s.key, s.name, s.display_order,
      count(v.id) FILTER (WHERE v.status NOT IN ('cancelled','no_show')) AS visits,
      count(v.id) FILTER (WHERE v.status = 'completed') AS completed,
      count(DISTINCT v.patient_id) FILTER (WHERE v.status NOT IN ('cancelled','no_show')) AS unique_patients,
      (SELECT count(*) FROM lab_requests r JOIN visits v2 ON v2.id = r.visit_id WHERE v2.service_key = s.key AND v2.queue_date BETWEEN _from AND _to) AS lab_requests,
      (SELECT count(*) FROM lab_request_items i JOIN lab_requests r ON r.id = i.lab_request_id JOIN visits v2 ON v2.id = r.visit_id
        WHERE v2.service_key = s.key AND v2.queue_date BETWEEN _from AND _to) AS lab_tests
    FROM service_categories s
    LEFT JOIN visits v ON v.service_key = s.key AND v.queue_date BETWEEN _from AND _to
    GROUP BY s.key, s.name, s.display_order
  ) x;
  RETURN jsonb_build_object('rows', res);
END $$;

-- 4. Laboratory test volume by category and test
CREATE OR REPLACE FUNCTION public.report_lab_volume(_from date, _to date) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  WITH it AS (
    SELECT t.section, t.name, t.code, t.display_order, i.status, lr.abnormal_flag
      FROM lab_request_items i
      JOIN lab_requests r ON r.id = i.lab_request_id
      JOIN lab_tests t ON t.id = i.lab_test_id
      LEFT JOIN lab_results lr ON lr.item_id = i.id
     WHERE public.clinic_date(r.created_at) BETWEEN _from AND _to
  )
  SELECT jsonb_build_object(
    'requests', (SELECT count(*) FROM lab_requests WHERE public.clinic_date(created_at) BETWEEN _from AND _to),
    'by_section', COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM (
        SELECT section, count(*) AS ordered, count(*) FILTER (WHERE status = 'verified') AS verified,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(*) FILTER (WHERE status NOT IN ('verified','cancelled')) AS pending,
               count(*) FILTER (WHERE status = 'verified' AND abnormal_flag IS NOT NULL) AS abnormal
          FROM it GROUP BY section) s), '[]'),
    'by_test', COALESCE((SELECT jsonb_agg(row_to_json(s) ORDER BY s.ordered DESC, s.name) FROM (
        SELECT section, name, code, count(*) AS ordered, count(*) FILTER (WHERE status = 'verified') AS verified,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(*) FILTER (WHERE status NOT IN ('verified','cancelled')) AS pending,
               count(*) FILTER (WHERE status = 'verified' AND abnormal_flag IS NOT NULL) AS abnormal
          FROM it GROUP BY section, name, code) s), '[]')
  ) INTO res;
  RETURN res;
END $$;

-- 5. Laboratory turnaround + currently pending tests
CREATE OR REPLACE FUNCTION public.report_lab_turnaround(_from date, _to date, _limit int DEFAULT 50, _offset int DEFAULT 0) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  WITH v AS (
    SELECT t.section, t.name, r.priority,
           extract(epoch FROM (i.verified_at - r.created_at)) / 60 AS req_to_verified,
           extract(epoch FROM (i.verified_at - COALESCE(i.collected_at, r.created_at))) / 60 AS collected_to_verified
      FROM lab_request_items i
      JOIN lab_requests r ON r.id = i.lab_request_id
      JOIN lab_tests t ON t.id = i.lab_test_id
     WHERE i.status = 'verified' AND i.verified_at IS NOT NULL AND public.clinic_date(r.created_at) BETWEEN _from AND _to
  ), pend AS (
    SELECT r.request_number, p.mrn, t.name AS test, t.section, i.status, r.priority, r.created_at AS requested_at,
           round((extract(epoch FROM (now() - r.created_at)) / 3600)::numeric, 1) AS hours_waiting
      FROM lab_request_items i
      JOIN lab_requests r ON r.id = i.lab_request_id
      JOIN lab_tests t ON t.id = i.lab_test_id
      JOIN patients p ON p.id = r.patient_id
     WHERE i.status NOT IN ('verified','cancelled')
  )
  SELECT jsonb_build_object(
    'overall', (SELECT jsonb_build_object('verified', count(*),
                 'median_minutes', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY req_to_verified)::numeric, 0),
                 'avg_minutes', round(avg(req_to_verified)::numeric, 0),
                 'median_collected_minutes', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY collected_to_verified)::numeric, 0),
                 'urgent_median_minutes', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY req_to_verified) FILTER (WHERE priority = 'urgent'))::numeric, 0)) FROM v),
    'by_test', COALESCE((SELECT jsonb_agg(row_to_json(s) ORDER BY s.section, s.name) FROM (
        SELECT section, name, count(*) AS verified,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY req_to_verified)::numeric, 0) AS median_minutes,
               round(avg(req_to_verified)::numeric, 0) AS avg_minutes,
               round(max(req_to_verified)::numeric, 0) AS max_minutes
          FROM v GROUP BY section, name) s), '[]'),
    'pending_by_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', n)) FROM (SELECT status, count(*) n FROM pend GROUP BY status) s), '[]'),
    'pending_total', (SELECT count(*) FROM pend),
    'pending', COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM (
        SELECT * FROM pend ORDER BY (priority = 'urgent') DESC, requested_at
         LIMIT LEAST(GREATEST(_limit,1),500) OFFSET GREATEST(_offset,0)) s), '[]')
  ) INTO res;
  RETURN res;
END $$;

-- 6. Appointments and queue
CREATE OR REPLACE FUNCTION public.report_appointments_queue(_from date, _to date) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  WITH a AS (SELECT status, public.clinic_date(scheduled_at) AS day FROM appointments WHERE public.clinic_date(scheduled_at) BETWEEN _from AND _to),
       v AS (SELECT * FROM visits WHERE queue_date BETWEEN _from AND _to)
  SELECT jsonb_build_object(
    'appointments_by_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', n) ORDER BY n DESC) FROM (SELECT status, count(*) n FROM a GROUP BY status) s), '[]'),
    'appointments_by_day', COALESCE((SELECT jsonb_agg(row_to_json(s) ORDER BY s.day) FROM (
        SELECT day, count(*) AS booked, count(*) FILTER (WHERE status IN ('checked_in','completed')) AS attended,
               count(*) FILTER (WHERE status = 'no_show') AS no_show, count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(*) FILTER (WHERE status = 'scheduled') AS still_scheduled
          FROM a GROUP BY day) s), '[]'),
    'visits_by_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', n) ORDER BY n DESC) FROM (SELECT status, count(*) n FROM v GROUP BY status) s), '[]'),
    'wait', (SELECT jsonb_build_object(
        'measured', count(*),
        'median_wait_minutes', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (started_at - checked_in_at)) / 60)::numeric, 0),
        'avg_wait_minutes', round(avg(extract(epoch FROM (started_at - checked_in_at)) / 60)::numeric, 0))
        FROM v WHERE started_at IS NOT NULL AND started_at >= checked_in_at),
    'visit_length', (SELECT jsonb_build_object(
        'measured', count(*),
        'median_minutes', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (completed_at - started_at)) / 60)::numeric, 0))
        FROM v WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at >= started_at),
    'checkins_by_hour', COALESCE((SELECT jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h) FROM (
        SELECT extract(hour FROM checked_in_at AT TIME ZONE 'Africa/Addis_Ababa')::int h, count(*) n FROM v GROUP BY 1) s), '[]')
  ) INTO res;
  RETURN res;
END $$;

-- 7. Staff activity (counts per staff member, no patient details)
CREATE OR REPLACE FUNCTION public.report_staff_activity(_from date, _to date) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.total_changes DESC, x.full_name), '[]') INTO res FROM (
    SELECT pr.id, pr.full_name, pr.active,
      (SELECT string_agg(ur.role::text, ',' ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = pr.id) AS roles,
      (SELECT count(*) FROM audit_log a WHERE a.user_id = pr.id AND public.clinic_date(a.changed_at) BETWEEN _from AND _to) AS total_changes,
      (SELECT count(*) FROM patients p WHERE p.created_by = pr.id AND public.clinic_date(p.created_at) BETWEEN _from AND _to) AS patients_registered,
      (SELECT count(*) FROM visits v WHERE v.checked_in_by = pr.id AND v.queue_date BETWEEN _from AND _to) AS visits_checked_in,
      (SELECT count(*) FROM consultations c WHERE c.signed_by = pr.id AND public.clinic_date(c.signed_at) BETWEEN _from AND _to) AS notes_signed,
      (SELECT count(*) FROM lab_requests r WHERE r.requested_by = pr.id AND public.clinic_date(r.created_at) BETWEEN _from AND _to) AS lab_orders,
      (SELECT count(*) FROM lab_results lr WHERE lr.entered_by = pr.id AND public.clinic_date(lr.entered_at) BETWEEN _from AND _to) AS results_entered,
      (SELECT count(*) FROM lab_request_items i WHERE i.verified_by = pr.id AND public.clinic_date(i.verified_at) BETWEEN _from AND _to) AS results_verified,
      (SELECT count(*) FROM consultation_amendments ca WHERE ca.created_by = pr.id AND public.clinic_date(ca.created_at) BETWEEN _from AND _to)
        + (SELECT count(*) FROM lab_result_amendments la WHERE la.amended_by = pr.id AND public.clinic_date(la.created_at) BETWEEN _from AND _to) AS amendments,
      (SELECT count(*) FROM audit_log a WHERE a.user_id = pr.id AND a.table_name IN ('user_roles','profiles','staff_accounts') AND public.clinic_date(a.changed_at) BETWEEN _from AND _to) AS permission_changes
    FROM profiles pr
  ) x;
  RETURN jsonb_build_object('rows', res);
END $$;

-- Audit events list with filters + pagination (details/diff loaded separately by id)
CREATE OR REPLACE FUNCTION public.report_audit_events(_from date, _to date, _user uuid DEFAULT NULL, _table text DEFAULT NULL, _action text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  WITH e AS (
    SELECT a.id, a.changed_at, a.user_id, a.table_name, a.action, a.record_id
      FROM audit_log a
     WHERE a.changed_at >= (_from::timestamp AT TIME ZONE 'Africa/Addis_Ababa')
       AND a.changed_at < ((_to + 1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa')
       AND (_user IS NULL OR a.user_id = _user)
       AND (_table IS NULL OR a.table_name = _table)
       AND (_action IS NULL OR a.action = _action)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM e),
    'rows', COALESCE((SELECT jsonb_agg(row_to_json(s) ORDER BY s.changed_at DESC, s.id DESC) FROM (
        SELECT e.*, COALESCE(pr.full_name, CASE WHEN e.user_id IS NULL THEN 'System' ELSE 'Unknown' END) AS staff_name
          FROM e LEFT JOIN profiles pr ON pr.id = e.user_id
         ORDER BY e.changed_at DESC, e.id DESC LIMIT LEAST(GREATEST(_limit,1),500) OFFSET GREATEST(_offset,0)) s), '[]')
  ) INTO res;
  RETURN res;
END $$;

-- ---------- C. Optional basic billing (disabled until the administrator switches it on) ----------
CREATE TABLE public.billing_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'ETB' CHECK (currency ~ '^[A-Z]{3}$'),
  approval_note text CHECK (approval_note IS NULL OR length(approval_note) <= 500),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.billing_settings TO authenticated;
GRANT ALL ON public.billing_settings TO service_role;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read billing settings" ON public.billing_settings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin update billing settings" ON public.billing_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.billing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.service_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('consultation','laboratory','procedure','other')),
  service_key text REFERENCES public.service_categories(key),
  lab_test_id uuid REFERENCES public.lab_tests(id),
  price numeric(12,2) NOT NULL CHECK (price >= 0 AND price <= 10000000),
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.service_charges TO authenticated;
GRANT ALL ON public.service_charges TO service_role;
ALTER TABLE public.service_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing read charges" ON public.service_charges FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));
CREATE POLICY "admin insert charges" ON public.service_charges FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin update charges" ON public.service_charges FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE SEQUENCE IF NOT EXISTS public.invoice_seq;
CREATE SEQUENCE IF NOT EXISTS public.receipt_seq;

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE,
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  visit_id uuid REFERENCES public.visits(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','void')),
  currency text NOT NULL DEFAULT 'ETB',
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid,
  issued_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_patient_idx ON public.invoices(patient_id);
CREATE INDEX invoices_created_idx ON public.invoices(created_at);
GRANT SELECT, INSERT, UPDATE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing read invoices" ON public.invoices FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));
CREATE POLICY "billing insert invoices" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));
CREATE POLICY "billing update invoices" ON public.invoices FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  charge_id uuid REFERENCES public.service_charges(id),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_items_invoice_idx ON public.invoice_items(invoice_id);
GRANT SELECT, INSERT, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing read items" ON public.invoice_items FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));
CREATE POLICY "billing insert items" ON public.invoice_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));
CREATE POLICY "billing delete draft items" ON public.invoice_items FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash','mobile_money','bank_transfer','card','other')),
  reference text CHECK (reference IS NULL OR length(reference) <= 100),
  received_by uuid,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx ON public.payments(invoice_id);
CREATE INDEX payments_received_idx ON public.payments(received_at);
GRANT SELECT, INSERT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing read payments" ON public.payments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));
CREATE POLICY "billing insert payments" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));

CREATE TABLE public.billing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  payment_id uuid REFERENCES public.payments(id),
  kind text NOT NULL CHECK (kind IN ('discount','payment_reversal','void')),
  amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_adjustments_invoice_idx ON public.billing_adjustments(invoice_id);
CREATE UNIQUE INDEX billing_one_reversal_per_payment ON public.billing_adjustments(payment_id) WHERE kind = 'payment_reversal';
GRANT SELECT, INSERT ON public.billing_adjustments TO authenticated;
GRANT ALL ON public.billing_adjustments TO service_role;
ALTER TABLE public.billing_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing read adjustments" ON public.billing_adjustments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::app_role[]));
CREATE POLICY "admin insert adjustments" ON public.billing_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.billing_settings, public.service_charges, public.invoices, public.invoice_items, public.payments, public.billing_adjustments FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.payments, public.billing_adjustments FROM authenticated;
REVOKE UPDATE, TRUNCATE ON public.invoice_items FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.invoices, public.service_charges, public.billing_settings FROM authenticated;

-- Running totals per invoice (RLS of the underlying tables applies)
CREATE VIEW public.invoice_balances WITH (security_invoker = true) AS
SELECT i.id AS invoice_id, t.total, d.discount, p.paid,
       (t.total - d.discount - p.paid) AS balance
  FROM public.invoices i
  CROSS JOIN LATERAL (SELECT COALESCE(sum(line_total), 0)::numeric(14,2) AS total FROM public.invoice_items WHERE invoice_id = i.id) t
  CROSS JOIN LATERAL (SELECT COALESCE(sum(amount), 0)::numeric(14,2) AS discount FROM public.billing_adjustments WHERE invoice_id = i.id AND kind = 'discount') d
  CROSS JOIN LATERAL (SELECT (COALESCE((SELECT sum(amount) FROM public.payments WHERE invoice_id = i.id), 0)
                            - COALESCE((SELECT sum(amount) FROM public.billing_adjustments WHERE invoice_id = i.id AND kind = 'payment_reversal'), 0))::numeric(14,2) AS paid) p;
GRANT SELECT ON public.invoice_balances TO authenticated;
GRANT SELECT ON public.invoice_balances TO service_role;
REVOKE ALL ON public.invoice_balances FROM anon;

CREATE OR REPLACE FUNCTION public.billing_enabled() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT COALESCE((SELECT enabled FROM public.billing_settings WHERE id = 1), false) $$;

CREATE OR REPLACE FUNCTION public.invoice_balance(_invoice uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT balance FROM public.invoice_balances WHERE invoice_id = _invoice $$;

CREATE OR REPLACE FUNCTION public.billing_settings_before() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  NEW.id := 1;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  IF NEW.currency <> OLD.currency AND EXISTS (SELECT 1 FROM public.invoices) THEN
    RAISE EXCEPTION 'The currency cannot change after invoices exist';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_settings_before BEFORE UPDATE ON public.billing_settings FOR EACH ROW EXECUTE FUNCTION public.billing_settings_before();

CREATE OR REPLACE FUNCTION public.service_charge_before() RETURNS trigger
  LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_charge_before BEFORE INSERT OR UPDATE ON public.service_charges FOR EACH ROW EXECUTE FUNCTION public.service_charge_before();

CREATE OR REPLACE FUNCTION public.invoice_before() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
  -- UPDATE
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'A void invoice cannot be changed'; END IF;
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Invoice number, patient, visit and currency cannot be changed';
  END IF;
  IF OLD.status = 'issued' AND NEW.notes IS DISTINCT FROM OLD.notes THEN RAISE EXCEPTION 'An issued invoice cannot be edited'; END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
      IF NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = OLD.id) THEN RAISE EXCEPTION 'Add at least one item before issuing'; END IF;
      NEW.issued_by := auth.uid(); NEW.issued_at := now();
    ELSIF NEW.status = 'void' THEN
      IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only an administrator can void an invoice'; END IF;
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
END $$;
CREATE TRIGGER invoice_before BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoice_before();

CREATE OR REPLACE FUNCTION public.invoice_item_before() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_status text; c record;
BEGIN
  IF NOT public.billing_enabled() THEN RAISE EXCEPTION 'Billing is not switched on'; END IF;
  SELECT status INTO v_status FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id) FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Items can only change while the invoice is a draft'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.charge_id IS NOT NULL THEN
    SELECT name, price, active INTO c FROM public.service_charges WHERE id = NEW.charge_id;
    IF c IS NULL OR NOT c.active THEN RAISE EXCEPTION 'This charge is not available'; END IF;
    -- Price always comes from the administrator's price list
    NEW.unit_price := c.price;
    NEW.description := COALESCE(NULLIF(btrim(NEW.description), ''), c.name);
  ELSIF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Choose a charge from the price list (only an administrator can add a custom item)';
  END IF;
  NEW.description := btrim(NEW.description);
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_item_before BEFORE INSERT OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.invoice_item_before();

CREATE OR REPLACE FUNCTION public.payment_before() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_status text; v_balance numeric;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Payments cannot be changed or deleted. An administrator can reverse a payment with a reason.'; END IF;
  IF NOT public.billing_enabled() THEN RAISE EXCEPTION 'Billing is not switched on'; END IF;
  SELECT status INTO v_status FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'issued' THEN RAISE EXCEPTION 'Payments can only be taken on an issued invoice'; END IF;
  v_balance := public.invoice_balance(NEW.invoice_id);
  IF NEW.amount > v_balance THEN RAISE EXCEPTION 'Payment (%) is more than the balance due (%)', NEW.amount, v_balance; END IF;
  NEW.reference := NULLIF(btrim(COALESCE(NEW.reference, '')), '');
  NEW.receipt_number := 'RCP-' || to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'YYMMDD') || '-' || lpad(nextval('public.receipt_seq')::text, 5, '0');
  NEW.received_by := auth.uid();
  NEW.received_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER payment_before BEFORE INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payment_before();

CREATE OR REPLACE FUNCTION public.billing_adjustment_before() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_status text; v_balance numeric; v_pay record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Adjustments cannot be changed or deleted'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only an administrator can make billing adjustments'; END IF;
  IF NOT public.billing_enabled() THEN RAISE EXCEPTION 'Billing is not switched on'; END IF;
  SELECT status INTO v_status FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_status = 'void' THEN RAISE EXCEPTION 'This invoice is already void'; END IF;
  NEW.reason := btrim(NEW.reason);
  v_balance := public.invoice_balance(NEW.invoice_id);
  IF NEW.kind = 'discount' THEN
    IF v_status <> 'issued' THEN RAISE EXCEPTION 'Discounts apply to issued invoices'; END IF;
    IF NEW.amount <= 0 OR NEW.amount > v_balance THEN RAISE EXCEPTION 'Discount must be more than 0 and not more than the balance (%)', v_balance; END IF;
    NEW.payment_id := NULL;
  ELSIF NEW.kind = 'payment_reversal' THEN
    SELECT * INTO v_pay FROM public.payments WHERE id = NEW.payment_id;
    IF v_pay IS NULL OR v_pay.invoice_id <> NEW.invoice_id THEN RAISE EXCEPTION 'Payment not found on this invoice'; END IF;
    NEW.amount := v_pay.amount;
  ELSE -- void
    IF EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = NEW.invoice_id
                AND NOT EXISTS (SELECT 1 FROM public.billing_adjustments a WHERE a.payment_id = p.id AND a.kind = 'payment_reversal')) THEN
      RAISE EXCEPTION 'Reverse the payments on this invoice before voiding it';
    END IF;
    NEW.amount := 0; NEW.payment_id := NULL;
  END IF;
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER billing_adjustment_before BEFORE INSERT OR UPDATE OR DELETE ON public.billing_adjustments FOR EACH ROW EXECUTE FUNCTION public.billing_adjustment_before();

CREATE OR REPLACE FUNCTION public.void_invoice(_invoice_id uuid, _reason text) RETURNS void
  LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.billing_adjustments (invoice_id, kind, amount, reason) VALUES (_invoice_id, 'void', 0, _reason);
  UPDATE public.invoices SET status = 'void', void_reason = btrim(_reason) WHERE id = _invoice_id;
END $$;

-- Billing report: daily totals and outstanding invoices (administrator only)
CREATE OR REPLACE FUNCTION public.report_billing(_from date, _to date) RETURNS jsonb
  LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.report_guard(_from, _to);
  SELECT jsonb_build_object(
    'currency', (SELECT currency FROM billing_settings WHERE id = 1),
    'enabled', (SELECT enabled FROM billing_settings WHERE id = 1),
    'by_day', COALESCE((SELECT jsonb_agg(row_to_json(s) ORDER BY s.day) FROM (
        SELECT d::date AS day,
          (SELECT count(*) FROM invoices i WHERE i.status <> 'void' AND public.clinic_date(i.issued_at) = d::date) AS invoices_issued,
          (SELECT COALESCE(sum(b.total),0) FROM invoices i JOIN invoice_balances b ON b.invoice_id = i.id WHERE i.status <> 'void' AND public.clinic_date(i.issued_at) = d::date) AS billed,
          (SELECT COALESCE(sum(amount),0) FROM payments p WHERE public.clinic_date(p.received_at) = d::date) AS collected,
          (SELECT COALESCE(sum(amount),0) FROM billing_adjustments a WHERE a.kind = 'payment_reversal' AND public.clinic_date(a.created_at) = d::date) AS reversed,
          (SELECT COALESCE(sum(amount),0) FROM billing_adjustments a WHERE a.kind = 'discount' AND public.clinic_date(a.created_at) = d::date) AS discounts
        FROM generate_series(_from, _to, interval '1 day') d) s), '[]'),
    'by_method', COALESCE((SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'count', n)) FROM (
        SELECT method, sum(amount) amt, count(*) n FROM payments WHERE public.clinic_date(received_at) BETWEEN _from AND _to GROUP BY method) s), '[]'),
    'outstanding_total', (SELECT COALESCE(sum(b.balance),0) FROM invoices i JOIN invoice_balances b ON b.invoice_id = i.id WHERE i.status = 'issued' AND b.balance > 0),
    'outstanding_count', (SELECT count(*) FROM invoices i JOIN invoice_balances b ON b.invoice_id = i.id WHERE i.status = 'issued' AND b.balance > 0)
  ) INTO res;
  RETURN res;
END $$;

-- Audit every billing table
CREATE TRIGGER billing_settings_audit AFTER INSERT OR UPDATE OR DELETE ON public.billing_settings FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER service_charges_audit AFTER INSERT OR UPDATE OR DELETE ON public.service_charges FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER invoices_audit AFTER INSERT OR UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER invoice_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER payments_audit AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER billing_adjustments_audit AFTER INSERT OR UPDATE OR DELETE ON public.billing_adjustments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- ---------- D. Function privileges: nothing callable without signing in except admin_exists ----------
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname, pg_get_function_result(p.oid) AS res
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    IF f.proname = 'admin_exists' THEN CONTINUE; END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.res = 'trigger' THEN
      -- Trigger functions run automatically; nobody needs to call them directly
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;
-- New functions created later should not be callable anonymously by default
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
-- Internal billing helpers are only used inside the billing triggers
REVOKE EXECUTE ON FUNCTION public.billing_enabled(), public.invoice_balance(uuid) FROM authenticated;
