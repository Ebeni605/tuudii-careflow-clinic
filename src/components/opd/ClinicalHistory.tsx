import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useServices, useStaffNames } from "@/lib/data";
import { fmtDate, fmtDateTime } from "@/lib/opd-queries";

/**
 * Patient's earlier clinical records (other visits): signed notes, diagnoses, medicines,
 * verified lab results and the vital-sign trend. Visible to clinicians and admin only (RLS).
 */
export function ClinicalHistory({ patientId, currentVisitId }: { patientId: string; currentVisitId?: string }) {
  const { data: services } = useServices();
  const { data: names } = useStaffNames();
  const { data, isLoading, error } = useQuery({
    queryKey: ["clinical_history", patientId, currentVisitId ?? ""],
    queryFn: async () => {
      const [visits, vitals, labs] = await Promise.all([
        supabase.from("visits")
          .select("id, checked_in_at, service_key, status, consultations(status, chief_complaint, assessment, treatment_notes, follow_up_date, follow_up_plan, clinician_id, signed_at, signed_by), diagnoses(id, description, icd10_code, diagnosis_type), medication_instructions(id, medicine, dose, route, frequency, duration), consultation_amendments(id)")
          .eq("patient_id", patientId).order("checked_in_at", { ascending: false }).limit(30),
        supabase.from("vital_signs").select("*").eq("patient_id", patientId).order("recorded_at", { ascending: false }).limit(15),
        supabase.from("lab_requests")
          .select("id, visit_id, request_number, created_at, lab_request_items(id, status, verified_at, lab_tests(name), lab_results(value, abnormal_flag, unit))")
          .eq("patient_id", patientId).order("created_at", { ascending: false }).limit(30),
      ]);
      if (visits.error) throw visits.error;
      if (vitals.error) throw vitals.error;
      if (labs.error) throw labs.error;
      return { visits: visits.data ?? [], vitals: vitals.data ?? [], labs: labs.data ?? [] };
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading clinical history…</p>;
  if (error) return <p className="text-sm text-destructive">Could not load clinical history.</p>;
  const previous = (data?.visits ?? []).filter((v) => v.id !== currentVisitId);
  const verifiedLabs = (data?.labs ?? [])
    .filter((l) => l.visit_id !== currentVisitId)
    .flatMap((l) => l.lab_request_items.filter((i) => i.status === "verified").map((i) => ({ ...i, request: l })));
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-primary/30 bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><History className="h-4 w-4" />Previous records — not part of the current visit</div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Vital signs trend</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {data?.vitals.length === 0 ? <p className="text-sm text-muted-foreground">No vital signs on record.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Date</th><th>BP</th><th>Pulse</th><th>Temp</th><th>SpO₂</th><th>Weight</th><th>BMI</th><th>Glucose</th></tr></thead>
              <tbody className="divide-y">
                {data?.vitals.map((v) => (
                  <tr key={v.id} className={v.visit_id === currentVisitId ? "bg-primary/5" : ""}>
                    <td className="py-1 text-xs">{fmtDateTime(v.recorded_at)}{v.visit_id === currentVisitId && <span className="ml-1 text-primary">(this visit)</span>}</td>
                    <td>{v.bp_systolic != null ? `${v.bp_systolic}/${v.bp_diastolic}` : "—"}</td><td>{v.pulse ?? "—"}</td><td>{v.temperature ?? "—"}</td>
                    <td>{v.spo2 ?? "—"}</td><td>{v.weight_kg ?? "—"}</td><td>{v.bmi ?? "—"}</td><td>{v.blood_glucose ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Earlier verified laboratory results</CardTitle></CardHeader>
        <CardContent>
          {verifiedLabs.length === 0 ? <p className="text-sm text-muted-foreground">No verified results from earlier visits.</p> : (
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {verifiedLabs.slice(0, 30).map((i) => (
                  <tr key={i.id}>
                    <td className="py-1 text-xs text-muted-foreground">{fmtDate(i.verified_at)}</td>
                    <td>{i.lab_tests?.name}</td>
                    <td className={i.lab_results?.abnormal_flag ? "font-bold text-destructive" : "font-semibold"}>{i.lab_results?.value ?? "—"} {i.lab_results?.unit} {i.lab_results?.abnormal_flag && `(${i.lab_results.abnormal_flag})`}</td>
                    <td className="text-right font-mono text-xs text-muted-foreground">{i.request.request_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Earlier visits</CardTitle></CardHeader>
        <CardContent className="divide-y text-sm">
          {previous.length === 0 && <p className="text-muted-foreground">No earlier visits.</p>}
          {previous.map((h) => {
            const c = h.consultations;
            return (
              <div key={h.id} className="space-y-0.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{svc(h.service_key)}</b>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">{fmtDate(h.checked_in_at)} <StatusBadge status={h.status} /></span>
                </div>
                {c?.chief_complaint && <div><span className="text-muted-foreground">Complaint:</span> {c.chief_complaint}</div>}
                {h.diagnoses.length > 0 && <div><span className="text-muted-foreground">Diagnosis:</span> {h.diagnoses.map((d) => `${d.description}${d.icd10_code ? ` (${d.icd10_code})` : ""}`).join("; ")}</div>}
                {c?.assessment && <div><span className="text-muted-foreground">Assessment:</span> {c.assessment}</div>}
                {c?.treatment_notes && <div><span className="text-muted-foreground">Plan:</span> {c.treatment_notes}</div>}
                {h.medication_instructions.length > 0 && <div><span className="text-muted-foreground">Medicines:</span> {h.medication_instructions.map((m) => [m.medicine, m.dose, m.route, m.frequency, m.duration].filter(Boolean).join(" ")).join("; ")}</div>}
                {c?.follow_up_date && <div><span className="text-muted-foreground">Follow-up:</span> {fmtDate(c.follow_up_date)} {c.follow_up_plan}</div>}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {c ? (c.status === "signed" ? <span>Signed by {names?.[c.signed_by ?? ""] ?? "—"} · {fmtDateTime(c.signed_at)}</span> : <span className="text-warning-foreground">Note not signed</span>) : <span>No consultation note</span>}
                  {h.consultation_amendments.length > 0 && <span>{h.consultation_amendments.length} amendment(s)</span>}
                  <Link className="text-primary hover:underline" to="/opd/visit/$visitId" params={{ visitId: h.id }}>Open visit</Link>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
