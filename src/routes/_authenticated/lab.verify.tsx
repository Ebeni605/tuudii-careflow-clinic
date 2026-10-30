import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { ReasonDialog } from "@/components/lab/ReasonDialog";
import { ResultValue } from "@/components/lab/TestRow";
import { supabase } from "@/integrations/supabase/client";
import { patientName, useLiveTable, useStaffNames } from "@/lib/data";
import { fmtDateTime } from "@/lib/opd-queries";
import { requireArea, useStaff } from "@/lib/auth";
import { canVerify, referenceText } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/lab/verify")({
  beforeLoad: requireArea("lab"),
  head: () => ({ meta: [{ title: "Result Verification — Two D Medium Clinic" }, { name: "description", content: "Review and verify laboratory results before they are released to OPD." }] }),
  component: () => <RequireArea area="lab"><Verify /></RequireArea>,
});

function Verify() {
  const { data: me } = useStaff();
  const { data: names } = useStaffNames();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [returning, setReturning] = useState<string | null>(null);
  useLiveTable("lab_request_items", [["verify_queue"]]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["verify_queue"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lab_request_items")
        .select("id, status, submitted_at, submitted_by, returned_reason, lab_tests(name, section), lab_results(*), lab_requests(id, request_number, priority, patients(mrn, first_name, middle_name, last_name, sex))")
        .eq("status", "awaiting_verification").order("submitted_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!me) return <PageLoading />;
  const rows = [...(data ?? [])].sort((a, b) => (a.lab_requests?.priority === "urgent" ? 0 : 1) - (b.lab_requests?.priority === "urgent" ? 0 : 1));
  const allowed = (r: (typeof rows)[number]) => canVerify({ enteredBy: r.lab_results?.entered_by, userId: me.id, canVerifyLab: me.canVerifyLab, canSelfVerify: me.canSelfVerify });

  async function verify(ids: string[]) {
    const { error } = await supabase.from("lab_request_items").update({ status: "verified" } as never).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} result(s) verified and released to OPD`);
    setSel(new Set()); refetch();
  }

  return (
    <div>
      <PageHeader title="Result verification" subtitle="Results reach OPD only after verification here. Entering a result never verifies it."
        actions={sel.size > 0 ? <Button onClick={() => verify([...sel])}>Verify selected ({sel.size})</Button> : undefined} />
      {!me.canVerifyLab && (
        <div className="mb-3 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">You can see this queue, but you do not have permission to verify results. The administrator grants this in Staff &amp; roles.</div>
      )}
      {isLoading ? <PageLoading /> : error ? <LoadError onRetry={() => refetch()} /> : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8" /><TableHead>Patient / request</TableHead><TableHead>Test</TableHead><TableHead>Result</TableHead>
                <TableHead>Reference</TableHead><TableHead>Entered by</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No results are waiting for verification.</TableCell></TableRow>}
                {rows.map((r) => {
                  const ok = allowed(r);
                  const res = r.lab_results;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{ok && <Checkbox aria-label="Select for verification" checked={sel.has(r.id)} onCheckedChange={() => { const n = new Set(sel); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setSel(n); }} />}</TableCell>
                      <TableCell>
                        <div className="font-medium">{patientName(r.lab_requests?.patients)}</div>
                        <div className="text-xs text-muted-foreground"><span className="font-mono">{r.lab_requests?.patients?.mrn}</span> · <Link className="font-mono text-primary hover:underline" to="/lab/request/$requestId" params={{ requestId: r.lab_requests!.id }}>{r.lab_requests?.request_number}</Link></div>
                        {r.lab_requests?.priority === "urgent" && <StatusBadge status="urgent" label="Urgent" />}
                      </TableCell>
                      <TableCell><div className="font-medium">{r.lab_tests?.name}</div><div className="text-xs text-muted-foreground">{r.lab_tests?.section}</div></TableCell>
                      <TableCell>{res ? <ResultValue value={res.value} flag={res.abnormal_flag} unit={res.unit} /> : "—"}{res?.comment && <div className="text-xs text-muted-foreground">{res.comment}</div>}</TableCell>
                      <TableCell className="text-xs">{res ? referenceText(res) || "not configured" : "—"}</TableCell>
                      <TableCell className="text-xs">{names?.[res?.entered_by ?? ""] ?? "—"}<div className="text-muted-foreground">{fmtDateTime(res?.entered_at)}</div></TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {ok ? <Button size="sm" onClick={() => verify([r.id])}>Verify</Button> : <span className="text-xs text-muted-foreground">{me.canVerifyLab ? "You entered this" : "No permission"}</span>}
                        {(me.canVerifyLab || res?.entered_by === me.id) && <Button size="sm" variant="ghost" onClick={() => setReturning(r.id)}>Return</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      <ReasonDialog open={!!returning} onOpenChange={(o) => !o && setReturning(null)} title="Return result for correction" confirmLabel="Return for correction"
        onConfirm={async (reason) => {
          const { error } = await supabase.from("lab_request_items").update({ status: "entered", returned_reason: reason } as never).eq("id", returning!);
          if (error) { toast.error(error.message); return false; }
          toast.success("Returned to the technician for correction"); refetch(); return true;
        }} />
    </div>
  );
}
