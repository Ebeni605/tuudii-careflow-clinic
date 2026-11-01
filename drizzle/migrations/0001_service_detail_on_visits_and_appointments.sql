ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS service_detail text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service_detail text;
ALTER TABLE public.visits ADD CONSTRAINT visits_service_detail_len CHECK (service_detail IS NULL OR length(service_detail) <= 200);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_service_detail_len CHECK (service_detail IS NULL OR length(service_detail) <= 200);
COMMENT ON COLUMN public.visits.service_detail IS 'Extra service details typed by reception (e.g. for Follow-up and Various Other Services)';
COMMENT ON COLUMN public.appointments.service_detail IS 'Extra service details typed by reception (e.g. for Follow-up and Various Other Services)';