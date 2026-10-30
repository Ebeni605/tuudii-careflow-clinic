import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Shared OPD encounter queries so panels and the page share one cache entry.

export const visitQuery = (visitId: string) =>
  queryOptions({
    queryKey: ["visit", visitId],
    queryFn: async () => {
      const { data, error } = await supabase.from("visits").select("*, patients(*)").eq("id", visitId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const consultQuery = (visitId: string) =>
  queryOptions({
    queryKey: ["consult", visitId],
    queryFn: async () => {
      const { data, error } = await supabase.from("consultations").select("*").eq("visit_id", visitId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const dxQuery = (visitId: string) =>
  queryOptions({
    queryKey: ["dx", visitId],
    queryFn: async () => {
      const { data, error } = await supabase.from("diagnoses").select("*").eq("visit_id", visitId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

export const medsQuery = (visitId: string) =>
  queryOptions({
    queryKey: ["meds", visitId],
    queryFn: async () => {
      const { data, error } = await supabase.from("medication_instructions").select("*").eq("visit_id", visitId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

export const vitalsQuery = (visitId: string) =>
  queryOptions({
    queryKey: ["vitals", visitId],
    queryFn: async () => {
      const { data, error } = await supabase.from("vital_signs").select("*").eq("visit_id", visitId).order("recorded_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const visitLabsQuery = (visitId: string) =>
  queryOptions({
    queryKey: ["visit_labs", visitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_requests")
        .select("*, lab_request_items(*, lab_tests(name, section, display_order), lab_results(value, abnormal_flag, comment, unit, ref_low, ref_high, ref_text)), lab_result_amendments(item_id)")
        .eq("visit_id", visitId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

export const amendmentsQuery = (consultationId: string) =>
  queryOptions({
    queryKey: ["amendments", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("consultation_amendments").select("*").eq("consultation_id", consultationId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" });
}
export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Addis_Ababa" });
}
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? `${iso}T12:00:00+03:00` : iso).toLocaleDateString([], { dateStyle: "medium", timeZone: "Africa/Addis_Ababa" });
}
