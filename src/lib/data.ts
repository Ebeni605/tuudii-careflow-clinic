import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function patientName(p: { first_name: string; middle_name?: string | null; last_name: string } | null | undefined) {
  if (!p) return "";
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ");
}

export { clinicToday as today } from "./patient-schema";

/** Start/end of a clinic (Ethiopia, UTC+3) day as ISO timestamps. */
export function clinicDayRange(day: string) {
  return { from: new Date(`${day}T00:00:00+03:00`).toISOString(), to: new Date(`${day}T23:59:59.999+03:00`).toISOString() };
}

export function useServices() {
  return useQuery({
    queryKey: ["services"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("service_categories").select("*").eq("active", true).order("display_order");
      if (error) throw error;
      return data;
    },
  });
}

export function useLabTests() {
  return useQuery({
    queryKey: ["lab_tests"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("lab_tests").select("*").order("section").order("display_order");
      if (error) throw error;
      return data;
    },
  });
}

export function useStaffNames() {
  return useQuery({
    queryKey: ["staff_names"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name");
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name])) as Record<string, string>;
    },
  });
}

/** Invalidate the given query keys whenever rows change in a table. */
export function useLiveTable(table: "visits" | "lab_request_items" | "lab_requests" | "appointments" | "lab_specimens" | "lab_results", keys: string[][]) {
  const qc = useQueryClient();
  const sig = JSON.stringify(keys);
  useEffect(() => {
    const channel = supabase
      .channel(`${table}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        for (const k of JSON.parse(sig) as string[][]) qc.invalidateQueries({ queryKey: k });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, sig, qc]);
}

export const VISIT_STATUS_LABEL: Record<string, string> = {
  waiting: "Waiting",
  in_consultation: "In consultation",
  awaiting_lab: "Pending laboratory",
  ready_for_review: "Ready for review",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

export function useDiagnosisCatalog() {
  return useQuery({
    queryKey: ["diagnosis_catalog"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("diagnosis_catalog").select("*").order("display_order").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export const APPT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked in",
  cancelled: "Cancelled",
  no_show: "No show",
  completed: "Completed",
};

export const LAB_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  collected: "Sample collected",
  received: "Sample received",
  processing: "Processing",
  entered: "Result entered",
  awaiting_verification: "Awaiting verification",
  verified: "Verified",
  rejected: "Specimen rejected — recollect",
  cancelled: "Cancelled",
  in_progress: "In progress",
};

export const SPECIMEN_STATUS_LABEL: Record<string, string> = {
  collected: "Collected",
  received: "Received",
  rejected: "Rejected",
};

/** Categories in the order of the clinic's paper Laboratory Request form. */
export const LAB_SECTIONS = ["Hematology", "Serology", "Urine Analysis", "Microscopy Examination", "Bacteriology & Parasitology"];

export const RESULT_TYPE_LABEL: Record<string, string> = {
  numeric: "Number with unit",
  qualitative: "Choice (e.g. Positive / Negative)",
  text: "Text finding",
  microscopy: "Microscopy observation",
};

/** Usual pre-analytical sample conditions (shown as suggestions; free text allowed). */
export const SAMPLE_CONDITIONS = ["Acceptable", "Haemolysed", "Clotted", "Insufficient volume", "Lipaemic", "Wrong container", "Unlabelled / mislabelled", "Leaking"];
