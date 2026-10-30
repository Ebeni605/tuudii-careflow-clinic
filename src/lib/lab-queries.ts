import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Shared laboratory queries. Result values live in lab_results; the database only returns
// them to clinicians once the test is verified, so the same query is safe for OPD screens.

export const labRequestQuery = (requestId: string) =>
  queryOptions({
    queryKey: ["lab_req", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_requests")
        .select("*, patients(*), visits(id, queue_number, queue_date, service_key, checked_in_at), lab_request_items(*, lab_tests(*), lab_results(*)), lab_specimens(*, lab_specimen_tests(item_id)), lab_result_amendments(*)")
        .eq("id", requestId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export type LabRequestFull = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof labRequestQuery>["queryFn"]>>>>;
export type LabItemFull = LabRequestFull["lab_request_items"][number];
export type LabSpecimen = LabRequestFull["lab_specimens"][number];

/** Requests created on a clinic day (or all open ones), with what the worklist and dashboard need. */
export const labWorklistQuery = (mode: "open" | "day", from: string, to: string) =>
  queryOptions({
    queryKey: ["worklist", mode, from, to],
    queryFn: async () => {
      let q = supabase
        .from("lab_requests")
        .select("id, request_number, priority, status, created_at, requested_by, clinical_notes, consultation_id, patients(id, mrn, first_name, middle_name, last_name, sex, date_of_birth, dob_estimated), visits(queue_number, queue_date), lab_request_items(id, status, verified_at, lab_tests(name, section))")
        .order("created_at", { ascending: false })
        .limit(300);
      if (mode === "open") q = q.in("status", ["requested", "in_progress"]);
      else q = q.gte("created_at", from).lte("created_at", to);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

/** Short, readable encounter reference derived from the consultation record id. */
export function encounterRef(consultationId: string | null | undefined) {
  return consultationId ? `EN-${consultationId.slice(0, 8).toUpperCase()}` : "—";
}

/** "Visit #12 · 30 Oct 2026" from the reception queue number and clinic day. */
export function visitRef(v: { queue_number: number | null; queue_date: string } | null | undefined) {
  if (!v) return "—";
  const d = new Date(`${v.queue_date}T12:00:00+03:00`).toLocaleDateString([], { dateStyle: "medium", timeZone: "Africa/Addis_Ababa" });
  return `Visit #${v.queue_number ?? "—"} · ${d}`;
}
