import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { useStaffNames } from "@/lib/data";
import { fmtDateTime, visitLabsQuery } from "@/lib/opd-queries";
import { isResultVisibleToClinician, type LabItemStatus } from "@/lib/workflow";

/** Lab orders for a visit. Values are shown only once verified (final); OPD can never edit them. */
export function LabResults({ visitId }: { visitId: string }) {
  const { data: labs, isLoading } = useQuery(visitLabsQuery(visitId));
  const { data: names } = useStaffNames();
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!labs?.length) return <p className="text-sm text-muted-foreground">No laboratory orders for this visit.</p>;
  return (
    <div className="space-y-3">
      {labs.map((l) => (
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
              <StatusBadge status={l.status} />
              {l.status === "completed" && <Link className="text-xs text-primary hover:underline" to="/lab/report/$requestId" params={{ requestId: l.id }}>Print report</Link>}
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Test</th><th>Result</th><th>Reference</th><th>Note</th></tr></thead>
              <tbody className="divide-y">
                {l.lab_request_items.map((i) => {
                  const final = isResultVisibleToClinician(i.status as LabItemStatus);
                  const t = i.lab_tests;
                  return (
                    <tr key={i.id}>
                      <td className="py-1.5">{t?.name}</td>
                      <td className={`py-1.5 ${final && i.abnormal_flag ? "font-bold text-destructive" : "font-semibold"}`}>
                        {final ? (
                          <>{i.result_value} {t?.unit} {i.abnormal_flag && `(${i.abnormal_flag})`} <span className="ml-1 rounded bg-success/15 px-1 text-[10px] font-semibold uppercase text-success">Final</span></>
                        ) : i.status === "rejected" ? <StatusBadge status="rejected" /> : (
                          <span className="text-xs font-normal text-muted-foreground">Pending — <StatusBadge status={i.status} /></span>
                        )}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">{t?.ref_low != null ? `${t.ref_low}–${t.ref_high}` : t?.ref_text}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        {i.status === "rejected" ? `Rejected: ${i.rejection_reason}` : final ? <>{i.result_comment} <span className="block">Verified {fmtDateTime(i.verified_at)}</span></> : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
