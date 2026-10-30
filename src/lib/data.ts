import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function patientName(p: { first_name: string; middle_name?: string | null; last_name: string } | null | undefined) {
  if (!p) return "";
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ");
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
export function useLiveTable(table: "visits" | "lab_request_items" | "lab_requests", keys: string[][]) {
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
  awaiting_lab: "Awaiting lab",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

export const LAB_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  collected: "Collected",
  processing: "Processing",
  resulted: "Awaiting verification",
  verified: "Verified",
  rejected: "Rejected",
};
