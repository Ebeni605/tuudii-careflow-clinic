
-- ROLES & PROFILES
CREATE TYPE public.app_role AS ENUM ('admin','receptionist','clinician','lab_tech');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  active boolean NOT NULL DEFAULT true,
  can_self_verify boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _user_id AND r.role = _role AND p.active
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _user_id AND r.role = ANY(_roles) AND p.active
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['admin','receptionist','clinician','lab_tech']::public.app_role[])
$$;

CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
$$;
GRANT EXECUTE ON FUNCTION public.admin_exists() TO anon, authenticated;

CREATE POLICY "staff read profiles" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "admin manage profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin insert profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "read own or admin roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "admin insert roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- AUDIT
CREATE TABLE public.audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid,
  table_name text NOT NULL,
  record_id text,
  action text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  diff jsonb
);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read audit" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec jsonb;
BEGIN
  rec := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO public.audit_log(user_id, table_name, record_id, action, diff)
  VALUES (auth.uid(), TG_TABLE_NAME, rec->>'id', TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW)) ELSE rec END);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- SERVICES
CREATE TABLE public.service_categories (
  key text PRIMARY KEY,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
GRANT SELECT, INSERT, UPDATE ON public.service_categories TO authenticated;
GRANT ALL ON public.service_categories TO service_role;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read services" ON public.service_categories FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write services" ON public.service_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.service_categories(key,name,display_order) VALUES
 ('internal_medicine','Internal Medicine',1),
 ('acute_chronic','Acute & Chronic Disease',2),
 ('minor_surgery','Minor Surgery & Infant Circumcision',3),
 ('anc','Antenatal Care (ANC)',4),
 ('laboratory','Laboratory Service',5),
 ('family_planning','Family Planning',6),
 ('dental','Dental Care',7),
 ('diabetes','Diabetes Follow-up',8),
 ('hypertension','Hypertension Treatment',9),
 ('general_followup','General Follow-up & Other',10);

-- PATIENTS
CREATE SEQUENCE public.patient_mrn_seq;
CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn text UNIQUE,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  sex text NOT NULL CHECK (sex IN ('male','female')),
  date_of_birth date,
  phone text,
  address text,
  kebele text,
  woreda text,
  emergency_contact_name text,
  emergency_contact_phone text,
  allergies text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
GRANT USAGE ON SEQUENCE public.patient_mrn_seq TO authenticated, service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read patients" ON public.patients FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "reception insert patients" ON public.patients FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::public.app_role[]));
CREATE POLICY "reception update patients" ON public.patients FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.assign_mrn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.mrn := 'TDC-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.patient_mrn_seq')::text, 6, '0');
  ELSE
    NEW.mrn := OLD.mrn;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patients_mrn BEFORE INSERT OR UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.assign_mrn();
CREATE TRIGGER patients_touch BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER patients_audit AFTER INSERT OR UPDATE OR DELETE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- APPOINTMENTS
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  service_key text NOT NULL REFERENCES public.service_categories(key),
  clinician_id uuid REFERENCES public.profiles(id),
  scheduled_at timestamptz NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','checked_in','cancelled','no_show')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read appts" ON public.appointments FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "reception write appts" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::public.app_role[]));
CREATE POLICY "reception update appts" ON public.appointments FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::public.app_role[]));
CREATE TRIGGER appts_audit AFTER INSERT OR UPDATE OR DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- VISITS / QUEUE
CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id),
  service_key text NOT NULL REFERENCES public.service_categories(key),
  visit_type text NOT NULL DEFAULT 'walk_in' CHECK (visit_type IN ('walk_in','appointment')),
  queue_date date NOT NULL DEFAULT current_date,
  queue_number int,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','in_consultation','awaiting_lab','completed','cancelled','no_show')),
  assigned_clinician_id uuid REFERENCES public.profiles(id),
  reception_notes text,
  checked_in_by uuid DEFAULT auth.uid(),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX visits_queue_idx ON public.visits(queue_date, status);
GRANT SELECT, INSERT, UPDATE ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read visits" ON public.visits FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "reception insert visits" ON public.visits FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist']::public.app_role[]));
CREATE POLICY "clinical update visits" ON public.visits FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist','clinician']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','receptionist','clinician']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.visit_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext('queue' || NEW.queue_date::text));
    SELECT COALESCE(MAX(queue_number),0)+1 INTO NEW.queue_number FROM public.visits WHERE queue_date = NEW.queue_date;
    NEW.status := 'waiting';
  ELSE
    NEW.queue_number := OLD.queue_number;
    NEW.patient_id := OLD.patient_id;
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
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visits_before BEFORE INSERT OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visit_before();
CREATE TRIGGER visits_audit AFTER INSERT OR UPDATE OR DELETE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- VITALS
CREATE TABLE public.vital_signs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  bp_systolic int, bp_diastolic int, pulse int, temperature numeric(4,1),
  resp_rate int, spo2 int, weight_kg numeric(5,1), height_cm numeric(5,1),
  blood_glucose numeric(5,1),
  recorded_by uuid DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.vital_signs TO authenticated;
GRANT ALL ON public.vital_signs TO service_role;
ALTER TABLE public.vital_signs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinical read vitals" ON public.vital_signs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','receptionist','clinician']::public.app_role[]));
CREATE POLICY "clinical insert vitals" ON public.vital_signs FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['receptionist','clinician']::public.app_role[]));
CREATE POLICY "clinical update vitals" ON public.vital_signs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'clinician')) WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE TRIGGER vitals_audit AFTER INSERT OR UPDATE OR DELETE ON public.vital_signs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- CONSULTATIONS
CREATE TABLE public.consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  service_key text NOT NULL REFERENCES public.service_categories(key),
  chief_complaint text,
  history text,
  past_history text,
  examination text,
  treatment_notes text,
  follow_up_date date,
  follow_up_plan text,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  clinician_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.consultations TO authenticated;
GRANT ALL ON public.consultations TO service_role;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinical read consult" ON public.consultations FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician']::public.app_role[]));
CREATE POLICY "clinician insert consult" ON public.consultations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE POLICY "clinician update consult" ON public.consultations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'clinician')) WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE TRIGGER consult_touch BEFORE UPDATE ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER consult_audit AFTER INSERT OR UPDATE OR DELETE ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TABLE public.diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  description text NOT NULL,
  icd10_code text,
  diagnosis_type text NOT NULL DEFAULT 'primary' CHECK (diagnosis_type IN ('primary','secondary')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.diagnoses TO authenticated;
GRANT ALL ON public.diagnoses TO service_role;
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinical read dx" ON public.diagnoses FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician']::public.app_role[]));
CREATE POLICY "clinician insert dx" ON public.diagnoses FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE POLICY "clinician delete dx" ON public.diagnoses FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'clinician'));
CREATE TRIGGER dx_audit AFTER INSERT OR UPDATE OR DELETE ON public.diagnoses FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- LAB CATALOGUE
CREATE TABLE public.lab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  section text NOT NULL,
  panel text,
  specimen_type text,
  unit text,
  ref_low numeric,
  ref_high numeric,
  ref_text text,
  result_type text NOT NULL DEFAULT 'text' CHECK (result_type IN ('numeric','text')),
  display_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
GRANT SELECT, INSERT, UPDATE ON public.lab_tests TO authenticated;
GRANT ALL ON public.lab_tests TO service_role;
ALTER TABLE public.lab_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read tests" ON public.lab_tests FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write tests" ON public.lab_tests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER tests_audit AFTER INSERT OR UPDATE OR DELETE ON public.lab_tests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

INSERT INTO public.lab_tests(code,name,section,panel,specimen_type,unit,ref_low,ref_high,ref_text,result_type,display_order) VALUES
 ('WBC','WBC with diff','Hematology','CBC','Whole blood','x10³/µL',4,11,NULL,'numeric',1),
 ('NEUT','Neutrophils (N)','Hematology','CBC','Whole blood','%',40,75,NULL,'numeric',2),
 ('LYMPH','Lymphocytes (L)','Hematology','CBC','Whole blood','%',20,45,NULL,'numeric',3),
 ('MONO','Monocytes (M)','Hematology','CBC','Whole blood','%',2,10,NULL,'numeric',4),
 ('BASO','Basophils (B)','Hematology','CBC','Whole blood','%',0,1,NULL,'numeric',5),
 ('HGB','Hgb','Hematology','CBC','Whole blood','g/dL',12,17,NULL,'numeric',6),
 ('HCT','HCT','Hematology','CBC','Whole blood','%',36,50,NULL,'numeric',7),
 ('BF_HEM','B/F (Blood film)','Hematology',NULL,'Whole blood',NULL,NULL,NULL,'No parasite seen','text',8),
 ('BLOOD_GROUP','Blood Group','Hematology',NULL,'Whole blood',NULL,NULL,NULL,NULL,'text',9),
 ('PERIPH','Peripheral Morphology','Hematology',NULL,'Whole blood',NULL,NULL,NULL,NULL,'text',10),
 ('PT','PT','Hematology',NULL,'Citrated plasma','sec',11,13.5,NULL,'numeric',11),
 ('APTT','aPTT','Hematology',NULL,'Citrated plasma','sec',25,35,NULL,'numeric',12),
 ('INR','INR','Hematology',NULL,'Citrated plasma',NULL,0.8,1.2,NULL,'numeric',13),
 ('DDIMER','D-dimer','Hematology',NULL,'Citrated plasma','µg/mL',0,0.5,NULL,'numeric',14),
 ('LDH','LDH','Hematology',NULL,'Serum','U/L',140,280,NULL,'numeric',15),
 ('TIBC','TIBC','Hematology',NULL,'Serum','µg/dL',250,450,NULL,'numeric',16),
 ('FE','Serum Fe','Hematology',NULL,'Serum','µg/dL',60,170,NULL,'numeric',17),
 ('TRANSF','Transferrin','Hematology',NULL,'Serum','mg/dL',200,360,NULL,'numeric',18),
 ('ESR','ESR','Hematology',NULL,'Whole blood','mm/hr',0,20,NULL,'numeric',19),
 ('RBS','RBS/FBS','Hematology',NULL,'Blood','mg/dL',70,140,NULL,'numeric',20),
 ('WIDAL','Widal','Serology',NULL,'Serum',NULL,NULL,NULL,'Non-reactive','text',1),
 ('WEIL','Weil Felix','Serology',NULL,'Serum',NULL,NULL,NULL,'Non-reactive','text',2),
 ('HBSAG','HBsAg','Serology',NULL,'Serum',NULL,NULL,NULL,'Negative','text',3),
 ('HBSAB','HBsAb','Serology',NULL,'Serum',NULL,NULL,NULL,NULL,'text',4),
 ('HCV','HCV Ab','Serology',NULL,'Serum',NULL,NULL,NULL,'Negative','text',5),
 ('VDRL','VDRL','Serology',NULL,'Serum',NULL,NULL,NULL,'Non-reactive','text',6),
 ('CRP','CRP','Serology',NULL,'Serum',NULL,NULL,NULL,'Negative','text',7),
 ('HIV','HIV','Serology',NULL,'Serum',NULL,NULL,NULL,'Negative','text',8),
 ('ASO','ASO titer','Serology',NULL,'Serum','IU/mL',0,200,NULL,'numeric',9),
 ('MAL_RDT','Malaria RDT','Serology',NULL,'Whole blood',NULL,NULL,NULL,'Negative','text',10),
 ('RF','RF','Serology',NULL,'Serum',NULL,NULL,NULL,'Negative','text',11),
 ('HPYL_AB','H. pylori Ab','Serology',NULL,'Serum',NULL,NULL,NULL,'Negative','text',12),
 ('U_PH','pH','Urine Analysis','Urinalysis','Urine',NULL,4.5,8,NULL,'numeric',1),
 ('U_SG','Specific Gravity','Urine Analysis','Urinalysis','Urine',NULL,1.005,1.030,NULL,'numeric',2),
 ('U_PROT','Protein','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Negative','text',3),
 ('U_BLOOD','Blood','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Negative','text',4),
 ('U_LEUK','Leukocytes','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Negative','text',5),
 ('U_GLU','Glucose','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Negative','text',6),
 ('U_KET','Ketone','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Negative','text',7),
 ('U_URO','Urobilinogen','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Normal','text',8),
 ('U_BIL','Bilirubin','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Negative','text',9),
 ('U_NIT','Nitrite','Urine Analysis','Urinalysis','Urine',NULL,NULL,NULL,'Negative','text',10),
 ('M_WBC','WBC/HPF','Microscopy',NULL,'Urine','/HPF',0,5,NULL,'numeric',1),
 ('M_RBC','RBC/HPF','Microscopy',NULL,'Urine','/HPF',0,3,NULL,'numeric',2),
 ('M_CAST','Cast','Microscopy',NULL,'Urine',NULL,NULL,NULL,'None seen','text',3),
 ('M_EPI','Epithelial cells','Microscopy',NULL,'Urine',NULL,NULL,NULL,'Few','text',4),
 ('U_HCG','Urine HCG','Microscopy',NULL,'Urine',NULL,NULL,NULL,'Negative','text',5),
 ('U_24P','24hr Urine Protein','Microscopy',NULL,'24h urine','mg/24h',0,150,NULL,'numeric',6),
 ('STOOL','Stool Examination','Bacteriology & Parasitology',NULL,'Stool',NULL,NULL,NULL,'No ova/parasite seen','text',1),
 ('STOOL_APP','Appearance/Consistency','Bacteriology & Parasitology',NULL,'Stool',NULL,NULL,NULL,'Formed','text',2),
 ('HPYL_AG','H. pylori Ag','Bacteriology & Parasitology',NULL,'Stool',NULL,NULL,NULL,'Negative','text',3),
 ('OCCULT','Occult blood','Bacteriology & Parasitology',NULL,'Stool',NULL,NULL,NULL,'Negative','text',4),
 ('BF_PARA','B/F','Bacteriology & Parasitology',NULL,'Whole blood',NULL,NULL,NULL,'No parasite seen','text',5),
 ('SPUTUM','Sputum Exam','Bacteriology & Parasitology',NULL,'Sputum',NULL,NULL,NULL,NULL,'text',6),
 ('AFB','AFB (2X)','Bacteriology & Parasitology',NULL,'Sputum',NULL,NULL,NULL,'No AFB seen','text',7),
 ('KOH','KOH','Bacteriology & Parasitology',NULL,'Skin/nail scraping',NULL,NULL,NULL,'No fungal element seen','text',8);

-- LAB REQUESTS
CREATE SEQUENCE public.lab_request_seq;
CREATE TABLE public.lab_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE,
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  requested_by uuid DEFAULT auth.uid(),
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent')),
  clinical_notes text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_progress','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.lab_requests TO authenticated;
GRANT ALL ON public.lab_requests TO service_role;
GRANT USAGE ON SEQUENCE public.lab_request_seq TO authenticated, service_role;
ALTER TABLE public.lab_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab read requests" ON public.lab_requests FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician','lab_tech']::public.app_role[]));
CREATE POLICY "clinician insert requests" ON public.lab_requests FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE POLICY "lab update requests" ON public.lab_requests FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['clinician','lab_tech']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['clinician','lab_tech']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.lab_request_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.request_number := 'LR-' || to_char(now(),'YYMMDD') || '-' || lpad(nextval('public.lab_request_seq')::text, 5, '0');
  NEW.requested_by := auth.uid();
  RETURN NEW;
END $$;
CREATE TRIGGER lab_req_number BEFORE INSERT ON public.lab_requests FOR EACH ROW EXECUTE FUNCTION public.lab_request_number();
CREATE TRIGGER lab_req_audit AFTER INSERT OR UPDATE OR DELETE ON public.lab_requests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TABLE public.lab_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_request_id uuid NOT NULL REFERENCES public.lab_requests(id) ON DELETE CASCADE,
  lab_test_id uuid NOT NULL REFERENCES public.lab_tests(id),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','collected','processing','resulted','verified','rejected')),
  specimen_id text,
  collected_by uuid, collected_at timestamptz,
  processed_by uuid, processed_at timestamptz,
  result_value text,
  abnormal_flag text CHECK (abnormal_flag IN ('L','H','A')),
  result_comment text,
  resulted_by uuid, resulted_at timestamptz,
  verified_by uuid, verified_at timestamptz,
  rejection_reason text
);
GRANT SELECT, INSERT, UPDATE ON public.lab_request_items TO authenticated;
GRANT ALL ON public.lab_request_items TO service_role;
ALTER TABLE public.lab_request_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab read items" ON public.lab_request_items FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','clinician','lab_tech']::public.app_role[]));
CREATE POLICY "clinician insert items" ON public.lab_request_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'clinician'));
CREATE POLICY "lab update items" ON public.lab_request_items FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'lab_tech')) WITH CHECK (public.has_role(auth.uid(),'lab_tech'));

CREATE OR REPLACE FUNCTION public.lab_item_before()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE self_ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'requested';
    RETURN NEW;
  END IF;
  IF OLD.status IN ('verified','rejected') THEN
    RAISE EXCEPTION 'This result is final and cannot be changed';
  END IF;
  NEW.lab_request_id := OLD.lab_request_id;
  NEW.lab_test_id := OLD.lab_test_id;
  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'requested' AND NEW.status IN ('collected','rejected')) OR
      (OLD.status = 'collected' AND NEW.status IN ('processing','rejected')) OR
      (OLD.status = 'processing' AND NEW.status IN ('resulted','rejected')) OR
      (OLD.status = 'resulted' AND NEW.status IN ('verified','processing'))
    ) THEN
      RAISE EXCEPTION 'Lab status cannot change from % to %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'collected' THEN NEW.collected_by := auth.uid(); NEW.collected_at := now(); END IF;
    IF NEW.status = 'processing' THEN NEW.processed_by := auth.uid(); NEW.processed_at := now(); END IF;
    IF NEW.status = 'resulted' THEN
      IF NEW.result_value IS NULL OR btrim(NEW.result_value) = '' THEN RAISE EXCEPTION 'Enter a result first'; END IF;
      NEW.resulted_by := auth.uid(); NEW.resulted_at := now();
    END IF;
    IF NEW.status = 'rejected' AND (NEW.rejection_reason IS NULL OR btrim(NEW.rejection_reason) = '') THEN
      RAISE EXCEPTION 'A rejection reason is required';
    END IF;
    IF NEW.status = 'verified' THEN
      SELECT can_self_verify INTO self_ok FROM public.profiles WHERE id = auth.uid();
      IF OLD.resulted_by = auth.uid() AND NOT COALESCE(self_ok,false) THEN
        RAISE EXCEPTION 'A different technician must verify this result';
      END IF;
      NEW.verified_by := auth.uid(); NEW.verified_at := now();
    END IF;
  ELSE
    -- keep stamps immutable when status unchanged
    NEW.resulted_by := OLD.resulted_by; NEW.resulted_at := OLD.resulted_at;
    NEW.verified_by := OLD.verified_by; NEW.verified_at := OLD.verified_at;
    IF OLD.status = 'resulted' AND NEW.result_value IS DISTINCT FROM OLD.result_value THEN
      RAISE EXCEPTION 'Send back to processing before changing an entered result';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_item_before BEFORE INSERT OR UPDATE ON public.lab_request_items FOR EACH ROW EXECUTE FUNCTION public.lab_item_before();
CREATE TRIGGER lab_item_audit AFTER INSERT OR UPDATE OR DELETE ON public.lab_request_items FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE OR REPLACE FUNCTION public.lab_item_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE open_count int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE status NOT IN ('verified','rejected')), count(*)
    INTO open_count, total FROM public.lab_request_items WHERE lab_request_id = NEW.lab_request_id;
  UPDATE public.lab_requests SET status = CASE
      WHEN open_count = 0 THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM public.lab_request_items WHERE lab_request_id = NEW.lab_request_id AND status <> 'requested') THEN 'in_progress'
      ELSE 'requested' END
    WHERE id = NEW.lab_request_id AND status <> 'cancelled';
  RETURN NEW;
END $$;
CREATE TRIGGER lab_item_after AFTER INSERT OR UPDATE ON public.lab_request_items FOR EACH ROW EXECUTE FUNCTION public.lab_item_after();

-- REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.visits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_request_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_requests;

-- FICTIONAL SAMPLE PATIENTS (development only)
INSERT INTO public.patients(first_name,middle_name,last_name,sex,date_of_birth,phone,kebele,woreda,allergies,emergency_contact_name,emergency_contact_phone) VALUES
 ('Demo','Abebe','Testfirst','male','1985-03-12','0900000001','01','Demo Woreda',NULL,'Demo Contact','0900000101'),
 ('Sample','Chaltu','Patient','female','1992-07-25','0900000002','02','Demo Woreda','Penicillin','Demo Contact','0900000102'),
 ('Fictional','Gemechu','Person','male','1960-11-02','0900000003','03','Demo Woreda',NULL,'Demo Contact','0900000103'),
 ('Test','Lensa','Mother','female','1998-01-18','0900000004','01','Demo Woreda',NULL,'Demo Contact','0900000104'),
 ('Example','Tolera','Child','male','2024-05-09','0900000005','04','Demo Woreda',NULL,'Demo Parent','0900000105');
