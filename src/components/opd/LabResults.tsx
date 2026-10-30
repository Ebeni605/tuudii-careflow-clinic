import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { useStaffNames } from "@/lib/data";
import { fmtDateTime, visitLabsQuery } from "@/lib/opd-queries";
import { referenceText } from "@/lib/workflow";

const FLAG: Record<string, string> = { L: "Low", H: "High", A: "Abnormal" };

/**
 * Lab orders for a visit, matched by visit/order/test ids. Values arrive only once verified
 * (the database withholds unverified results from clinicians); OPD can never edit them.
 */
export function LabResults({ visitId }: { visitId: string }) {
  const { data: labs, isLoading } = useQuery(visitLabsQuery(visitId));
  const { data: names } = useStaffNames();
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!labs?.length) return <p className="text-sm text-muted-foreground">No laboratory orders for this visit.</p>;
  return (
    <div className="space-y-3">
      {labs.map((l) => {
        const amended = new Set(l.lab_result_amendments.map((a) => a.item_id));
        const verified = l.lab_request_items.filter((i) => i.status === "verified").length;
        return (
          <Card key={l.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm">
                <span className="font-mono">{l.request_number}</span>{" "}
                {l.priority === "urgent" && <StatusBadge status="urgent" label="Urgent" />}
                <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                  Ordered {fmtDateTime(l.created_at)} by {names?.[l.requested_by ?? ""] ?? "—"}{l.clinical_notes && ` · Indication: ${l.clinical_notes}`}
                </div>
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{verified}/{l.lab_request_items.length} verified</span>
                <StatusBadge status={l.status} />
                <Link className="text-xs text-primary hover:underline" to="/lab/report/$requestId" params={{ requestId: l.id }}>{l.status === "completed" ? "Print report" : "Preview report"}</Link>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Test</th><th>Result</th><th>Reference</th><th>Status / note</th></tr></thead>
                <tbody className="divide-y">
                  {l.lab_request_items.map((i) => {
                    const r = i.status === "verified" ? i.lab_results : null;
                    return (
                      <tr key={i.id}>
                        <td className="py-1.5">{i.lab_tests?.name}</td>
                        <td className={`py-1.5 ${r?.abnormal_flag ? "font-bold text-destructive" : "font-semibold"}`}>
                          {r ? <>{r.value} {r.unit} {r.abnormal_flag && `(${FLAG[r.abnormal_flag] ?? r.abnormal_flag})`} <span className="ml-1 rounded bg-success/15 px-1 text-[10px] font-semibold uppercase text-success">Final</span></>
                            : <span className="text-xs font-normal text-muted-foreground">{i.status === "cancelled" ? "Not done" : "Pending"}</span>}
                        </td>
                        <td className="py-1.5 text-xs text-muted-foreground">{r ? referenceText(r) : ""}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">
                          <StatusBadge status={i.status} />
                          {i.status === "cancelled" && <div>Cancelled: {i.cancel_reason}</div>}
                          {i.status === "rejected" && <div>Specimen rejected ({i.rejection_reason}) — laboratory will recollect</div>}
                          {amended.has(i.id) && i.status !== "verified" && <div className="text-warning-foreground">Being corrected by the laboratory</div>}
                          {r && <div>{r.comment && <>Remark: {r.comment} · </>}Verified {fmtDateTime(i.verified_at)} by {names?.[i.verified_by ?? ""] ?? "—"}{amended.has(i.id) && " · corrected result"}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
