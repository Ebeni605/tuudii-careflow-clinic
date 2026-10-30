import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintHeader } from "@/components/ClinicBrand";
import { LoadError, PageLoading, RequireArea } from "@/components/AppShell";
import { requireArea } from "@/lib/auth";
import { LAB_SECTIONS, patientName, useServices, useStaffNames } from "@/lib/data";
import { encounterRef, labRequestQuery, visitRef } from "@/lib/lab-queries";
import { fmtDateTime } from "@/lib/opd-queries";
import { ageFromDob, referenceText } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/lab/report/$requestId")({
  beforeLoad: requireArea("results"),
  head: () => ({ meta: [{ title: "Laboratory Report — Two D Medium Clinic" }, { name: "description", content: "Printable A4 laboratory report with verified results." }] }),
  component: () => <RequireArea area="results"><Report /></RequireArea>,
});

const FLAG: Record<string, string> = { L: "L", H: "H", A: "Abn" };

function Report() {
  const { requestId } = Route.useParams();
  const { data: names } = useStaffNames();
  const { data: services } = useServices();
  const { data: req, isLoading, error, refetch } = useQuery(labRequestQuery(requestId));
  if (isLoading) return <PageLoading />;
  if (error) return <LoadError onRetry={() => refetch()} />;
  if (!req) return <LoadError message="Report not found." />;
  const nm = (id: string | null | undefined) => (id ? names?.[id] ?? "—" : "—");
  const p = req.patients!;
  const all = req.lab_request_items;
  const verified = all.filter((i) => i.status === "verified");
  const cancelled = all.filter((i) => i.status === "cancelled");
  const pending = all.filter((i) => i.status !== "verified" && i.status !== "cancelled");
  const final = pending.length === 0;
  const amendedIds = new Set(req.lab_result_amendments.map((a) => a.item_id));
  const performers = [...new Set(verified.map((i) => i.lab_results?.entered_by).filter(Boolean))].map(nm).join(", ");
  const verifiers = [...new Set(verified.map((i) => i.verified_by).filter(Boolean))].map(nm).join(", ");
  const lastVerified = verified.map((i) => i.verified_at).filter(Boolean).sort().at(-1);
  const specimens = req.lab_specimens.filter((s) => s.status !== "rejected").sort((a, b) => a.collected_at.localeCompare(b.collected_at));
  const svc = services?.find((s) => s.key === req.visits?.service_key)?.name ?? "—";
  const order = (s: string | undefined) => { const i = LAB_SECTIONS.indexOf(s ?? ""); return i < 0 ? 99 : i; };
  const sections = [...new Set(all.map((i) => i.lab_tests?.section ?? ""))].sort((a, b) => order(a) - order(b));

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {final ? "All tests are verified or cancelled — this is the final report." : `${pending.length} test(s) are not verified yet. Their values are not printed; the report is marked incomplete.`}
        </p>
        <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print (A4)</Button>
      </div>
      <div className="print-area a4-page mx-auto rounded-md border bg-card p-8 text-[13px] shadow-sm">
        <PrintHeader title="Laboratory Report" />

        <div className={`mt-3 rounded px-3 py-1.5 text-center text-sm font-bold tracking-wide ${final ? "bg-secondary text-primary" : "border-2 border-destructive text-destructive"}`}>
          {final ? "FINAL REPORT — VERIFIED RESULTS" : "INCOMPLETE REPORT — SOME RESULTS PENDING VERIFICATION"}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-0.5">
          <div><b>Report no:</b> <span className="font-mono">{req.request_number}</span></div>
          <div><b>Report date:</b> {fmtDateTime(lastVerified ?? new Date().toISOString())}</div>
          <div><b>Patient name:</b> {patientName(p)}</div>
          <div><b>Patient ID (card no):</b> <span className="font-mono">{p.mrn}</span></div>
          <div><b>Age:</b> {ageFromDob(p.date_of_birth, new Date(), p.dob_estimated) ?? "—"} &nbsp; <b>Sex:</b> <span className="capitalize">{p.sex}</span></div>
          <div><b>Encounter:</b> {encounterRef(req.consultation_id)} · {visitRef(req.visits)}</div>
          <div><b>Service:</b> {svc}</div>
          <div><b>Requested:</b> {fmtDateTime(req.created_at)}{req.priority === "urgent" && " · URGENT"}</div>
          <div><b>Requesting clinician:</b> {nm(req.requested_by)}</div>
          <div><b>Clinical indication:</b> {req.clinical_notes || "—"}</div>
        </div>

        <div className="mt-3">
          <div className="text-xs font-bold uppercase tracking-wide text-primary">Specimens</div>
          {specimens.length === 0 ? <div className="text-xs">No specimen recorded.</div> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th>Specimen no.</th><th>Type</th><th>Collected</th><th>Received</th><th>Condition</th></tr></thead>
              <tbody>
                {specimens.map((s) => (
                  <tr key={s.id}><td className="font-mono">{s.accession_number}</td><td>{s.specimen_type}</td><td>{fmtDateTime(s.collected_at)} ({nm(s.collected_by)})</td><td>{fmtDateTime(s.received_at)}</td><td>{s.condition ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {sections.map((s) => {
          const rows = all.filter((i) => (i.lab_tests?.section ?? "") === s)
            .sort((a, b) => (a.lab_tests?.display_order ?? 0) - (b.lab_tests?.display_order ?? 0));
          return (
            <div key={s} className="mt-4 break-inside-avoid">
              <div className="border-b-2 border-primary text-xs font-bold uppercase tracking-wide text-primary">{s}</div>
              <table className="mt-1 w-full">
                <thead><tr className="text-left text-[11px] text-muted-foreground"><th className="w-[28%] py-0.5">Investigation</th><th className="w-[24%]">Result</th><th className="w-[10%]">Unit</th><th className="w-[18%]">Reference</th><th>Remarks</th></tr></thead>
                <tbody className="divide-y">
                  {rows.map((i) => {
                    const t = i.lab_tests!;
                    const r = i.lab_results;
                    const isFinal = i.status === "verified" && r;
                    return (
                      <tr key={i.id} className="align-top">
                        <td className="py-1">{t.name}</td>
                        <td className={isFinal && r.abnormal_flag ? "font-bold" : isFinal ? "font-semibold" : "italic text-muted-foreground"}>
                          {isFinal ? <>{r.value}{r.abnormal_flag && <span className="ml-1 rounded border border-destructive px-1 text-[10px] text-destructive">{FLAG[r.abnormal_flag]}</span>}</>
                            : i.status === "cancelled" ? "Not done" : "Pending"}
                        </td>
                        <td>{isFinal ? r.unit : ""}</td>
                        <td className="text-[11px]">{isFinal ? referenceText(r) : ""}</td>
                        <td className="text-[11px]">
                          {i.status === "cancelled" ? `Cancelled: ${i.cancel_reason}` : isFinal ? r.comment : ""}
                          {isFinal && amendedIds.has(i.id) && <div className="font-semibold">Corrected result (re-verified)</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        <p className="mt-3 text-[10px] text-muted-foreground">
          L = below, H = above the laboratory's configured reference interval; Abn = abnormal finding. Reference intervals are those configured by the laboratory at the time of testing.
          {cancelled.length > 0 && " Cancelled tests were not performed."}
        </p>

        <div className="mt-8 grid grid-cols-2 gap-8 text-[13px]">
          <div>
            <div><b>Performed by:</b> {performers || "………………………"}</div>
            <div className="mt-6 border-t border-foreground pt-1 text-xs">Signature</div>
          </div>
          <div>
            <div><b>Verified by:</b> {verifiers || "………………………"}</div>
            <div><b>Verified on:</b> {lastVerified ? fmtDateTime(lastVerified) : "………………………"}</div>
            <div className="mt-6 border-t border-foreground pt-1 text-xs">Signature &amp; laboratory stamp</div>
          </div>
        </div>
        <div className="mt-4 text-center text-[10px] text-muted-foreground">Printed {fmtDateTime(new Date().toISOString())} · {req.request_number}</div>
      </div>
    </div>
  );
}
