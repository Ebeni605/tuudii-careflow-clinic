CREATE OR REPLACE FUNCTION public.encounter_child_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c_id uuid; c_status text; c_patient uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO c_status FROM public.consultations WHERE visit_id = OLD.visit_id;
    IF c_status = 'signed' THEN
      RAISE EXCEPTION 'This consultation is signed. Add an amendment instead.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Entries cannot be edited; remove and add again while the note is a draft'; END IF;
  SELECT id, status, patient_id INTO c_id, c_status, c_patient FROM public.consultations WHERE visit_id = NEW.visit_id;
  IF c_id IS NULL THEN RAISE EXCEPTION 'Start the consultation first'; END IF;
  IF c_status = 'signed' THEN RAISE EXCEPTION 'This consultation is signed. Add an amendment instead.'; END IF;
  NEW.patient_id := c_patient;
  NEW.consultation_id := c_id;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  NEW.created_at := now();
  RETURN NEW;
END $$;