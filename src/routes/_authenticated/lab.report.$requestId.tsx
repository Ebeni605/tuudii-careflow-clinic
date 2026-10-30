import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintHeader } from "@/components/ClinicBrand";
import { RequireArea } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { patientName, useStaffNames } from "@/lib/data";
import { ageFromDob } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/lab/report/$requestId")({
  head: () => ({ meta: [{ title: "Laboratory Report — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="patients"><Report /></RequireArea>,
});

const SECTIONS = ["Hematology", "Serology", "Urine Analysis", "Microscopy", "Bacteriology & Parasitology"];

function Report() {
  const { requestId } = Route.useParams();
  const { data: names } = useStaffNames();
  const { data: req } = useQuery({
    queryKey: ["lab_report", requestId],
    queryFn: async () => (await supabase.from("lab_requests").select("*, patients(*), lab_request_items(*, lab_tests(*))").eq("id", requestId).single()).data,
  });
  if (!req) return <div className="text-muted-foreground">Loading… (only clinical and laboratory staff can view reports)</div>;
  const p = req.patients!;
  const items = req.lab_request_items.filter((i) => i.status === "verified" || i.status === "rejected");
  const pending = req.lab_request_items.length - items.length;
  const verifiers = [...new Set(items.map((i) => i.verified_by).filter(Boolean))].map((id) => names?.[id!]).join(", ");
  const reporters = [...new Set(items.map((i) => i.resulted_by).filter(Boolean))].map((id) => names?.[id!]).join(", ");
  const lastVerified = items.map((i) => i.verified_at).filter(Boolean).sort().at(-1);

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{pending > 0 ? `${pending} test(s) not yet verified and not shown.` : "All tests verified."}</p>
        <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
      </div>
      <div className="print-area mx-auto max-w-3xl rounded-md border bg-card p-8 shadow-sm">
        <PrintHeader title="Laboratory Report" />
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div><b>Patient name:</b> {patientName(p)}</div>
          <div><b>Date:</b> {new Date(req.created_at).toLocaleDateString()}</div>
          <div><b>Age:</b> {ageFromDob(p.date_of_birth) ?? "—"} &nbsp; <b>Sex:</b> <span className="capitalize">{p.sex}</span></div>
          <div><b>Card no:</b> {p.mrn}</div>
          <div><b>Request no:</b> {req.request_number}</div>
          <div><b>Requested by:</b> {names?.[req.requested_by ?? ""] ?? "—"}</div>
        </div>
        {SECTIONS.map((s) => {
          const rows = items.filter((i) => i.lab_tests?.section === s);
          if (!rows.length) return null;
          return (
            <div key={s} className="mt-5">
              <div className="border-b-2 border-primary text-sm font-bold uppercase tracking-wide text-primary">{s}</div>
              <table className="mt-1 w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Test</th><th>Result</th><th>Unit</th><th>Reference</th><th>Comment</th></tr></thead>
                <tbody className="divide-y">
                  {rows.map((i) => {
                    const t = i.lab_tests!;
                    return (
                      <tr key={i.id}>
                        <td className="py-1">{t.name}</td>
                        <td className={`font-semibold ${i.abnormal_flag ? "text-destructive" : ""}`}>{i.status === "rejected" ? "Rejected" : i.result_value} {i.abnormal_flag && `(${i.abnormal_flag})`}</td>
                        <td>{t.unit}</td>
                        <td className="text-xs">{t.ref_low != null ? `${t.ref_low} – ${t.ref_high}` : t.ref_text}</td>
                        <td className="text-xs">{i.status === "rejected" ? i.rejection_reason : i.result_comment}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
        {items.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No verified results yet.</p>}
        <div className="mt-10 grid grid-cols-2 gap-6 text-sm">
          <div><b>Reported by:</b> {reporters || "…………………"}</div>
          <div><b>Verified by:</b> {verifiers || "…………………"}</div>
          <div />
          <div><b>Date:</b> {lastVerified ? new Date(lastVerified).toLocaleString() : "…………………"}</div>
        </div>
      </div>
    </div>
  );
}
