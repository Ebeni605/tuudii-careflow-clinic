import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { patientName, useLiveTable, useStaffNames } from "@/lib/data";
import { useStaff, requireArea } from "@/lib/auth";
import { abnormalFlag, ageFromDob, canVerify } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/lab/request/$requestId")({
  beforeLoad: requireArea("lab"),
  head: () => ({ meta: [{ title: "Lab Request — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="lab"><LabRequest /></RequireArea>,
});

function LabRequest() {
  const { requestId } = Route.useParams();
  const { data: me } = useStaff();
  const { data: names } = useStaffNames();
  const isTech = !!me?.roles.includes("lab_tech");
  useLiveTable("lab_request_items", [["lab_req", requestId]]);

  const { data: req, refetch } = useQuery({
    queryKey: ["lab_req", requestId],
    queryFn: async () => (await supabase.from("lab_requests").select("*, patients(*), lab_request_items(*, lab_tests(*))").eq("id", requestId).single()).data,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [specimen, setSpecimen] = useState("");

  if (!req) return <div className="text-muted-foreground">Loading…</div>;
  const p = req.patients!;
  const items = [...req.lab_request_items].sort((a, b) => (a.lab_tests?.section ?? "").localeCompare(b.lab_tests?.section ?? "") || (a.lab_tests?.display_order ?? 0) - (b.lab_tests?.display_order ?? 0));

  async function update(ids: string[], patch: Record<string, unknown>, ok: string) {
    for (const id of ids) {
      const { error } = await supabase.from("lab_request_items").update(patch as never).eq("id", id);
      if (error) { toast.error(error.message); refetch(); return; }
    }
    toast.success(ok);
    refetch();
  }
  const byStatus = (s: string) => items.filter((i) => i.status === s).map((i) => i.id);

  async function enterResult(i: (typeof items)[number]) {
    const val = (values[i.id] ?? i.result_value ?? "").trim();
    if (!val) { toast.error("Enter a result"); return; }
    const t = i.lab_tests!;
    const flag = t.result_type === "numeric" ? abnormalFlag(val, t.ref_low, t.ref_high) : null;
    await update([i.id], { result_value: val, result_comment: comments[i.id] || null, abnormal_flag: flag, status: "resulted" }, "Result entered — awaiting verification");
  }
  async function reject(id: string) {
    const reason = prompt("Reason for rejecting this specimen/test (e.g. haemolysed sample):");
    if (!reason?.trim()) return;
    await update([id], { status: "rejected", rejection_reason: reason.trim() }, "Test rejected");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${req.request_number}`}
        subtitle={`${patientName(p)} · ${p.mrn} · ${p.sex} · ${ageFromDob(p.date_of_birth) ?? ""} · requested by ${names?.[req.requested_by ?? ""] ?? "—"}`}
        actions={<>
          {req.priority === "urgent" && <StatusBadge status="urgent" label="Urgent" />}
          <Button variant="outline" asChild><Link to="/lab/report/$requestId" params={{ requestId }}><Printer className="mr-1 h-4 w-4" />Report</Link></Button>
        </>}
      />
      {req.clinical_notes && <div className="rounded-md border bg-card p-3 text-sm"><b>Clinical notes:</b> {req.clinical_notes}</div>}

      {isTech && (byStatus("requested").length > 0 || byStatus("collected").length > 0) && (
        <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
          {byStatus("requested").length > 0 && <>
            <div className="space-y-1"><div className="text-xs text-muted-foreground">Specimen / sample ID</div><Input className="w-48" value={specimen} onChange={(e) => setSpecimen(e.target.value)} placeholder="e.g. S-0142" /></div>
            <Button onClick={() => update(byStatus("requested"), { status: "collected", specimen_id: specimen || null }, "Specimen collected")}>Mark all collected ({byStatus("requested").length})</Button>
          </>}
          {byStatus("collected").length > 0 && <Button variant="secondary" onClick={() => update(byStatus("collected"), { status: "processing" }, "Processing started")}>Start processing ({byStatus("collected").length})</Button>}
        </CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Tests</CardTitle></CardHeader>
        <CardContent className="divide-y p-0">
          {items.map((i) => {
            const t = i.lab_tests!;
            const ref = t.ref_low != null ? `${t.ref_low}–${t.ref_high} ${t.unit ?? ""}` : t.ref_text ?? "";
            const verifyOk = me && canVerify({ resultedBy: i.resulted_by, userId: me.id, canSelfVerify: me.canSelfVerify });
            return (
              <div key={i.id} className="grid gap-2 p-3 md:grid-cols-[220px_1fr_auto] md:items-center">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.section} · {t.specimen_type}{i.specimen_id && ` · ${i.specimen_id}`}</div>
                </div>
                <div className="text-sm">
                  {i.status === "processing" && isTech ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input className="w-40" placeholder={t.ref_text ?? "Result"} value={values[i.id] ?? i.result_value ?? ""} onChange={(e) => setValues({ ...values, [i.id]: e.target.value })} />
                      <span className="text-xs text-muted-foreground">{t.unit}</span>
                      <Input className="w-56" placeholder="Comment (optional)" value={comments[i.id] ?? ""} onChange={(e) => setComments({ ...comments, [i.id]: e.target.value })} />
                      <span className="text-xs text-muted-foreground">Ref: {ref}</span>
                    </div>
                  ) : i.result_value ? (
                    <div>
                      <span className={`font-semibold ${i.abnormal_flag ? "text-destructive" : ""}`}>{i.result_value} {t.unit} {i.abnormal_flag && `(${i.abnormal_flag})`}</span>
                      <span className="ml-2 text-xs text-muted-foreground">Ref: {ref}</span>
                      {i.result_comment && <div className="text-xs text-muted-foreground">{i.result_comment}</div>}
                      <div className="text-xs text-muted-foreground">Entered by {names?.[i.resulted_by ?? ""] ?? "—"}{i.verified_by && ` · verified by ${names?.[i.verified_by] ?? "—"}`}</div>
                    </div>
                  ) : i.status === "rejected" ? <span className="text-destructive">Rejected: {i.rejection_reason}</span> : <span className="text-muted-foreground">Ref: {ref}</span>}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <StatusBadge status={i.status} />
                  {isTech && i.status === "processing" && <Button size="sm" onClick={() => enterResult(i)}>Save result</Button>}
                  {isTech && i.status === "resulted" && (verifyOk
                    ? <Button size="sm" onClick={() => update([i.id], { status: "verified" }, "Result verified and sent to OPD")}>Verify</Button>
                    : <span className="text-xs text-muted-foreground">Another technician must verify</span>)}
                  {isTech && i.status === "resulted" && <Button size="sm" variant="ghost" onClick={() => update([i.id], { status: "processing" }, "Returned for correction")}>Correct</Button>}
                  {isTech && ["requested", "collected", "processing"].includes(i.status) && <Button size="sm" variant="ghost" onClick={() => reject(i.id)}>Reject</Button>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
