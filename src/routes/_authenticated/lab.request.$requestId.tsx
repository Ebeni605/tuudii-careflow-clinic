import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Printer, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SpecimenPanel } from "@/components/lab/SpecimenPanel";
import { TestRow } from "@/components/lab/TestRow";
import { supabase } from "@/integrations/supabase/client";
import { LAB_SECTIONS, patientName, useLiveTable, useServices, useStaffNames } from "@/lib/data";
import { encounterRef, labRequestQuery, visitRef } from "@/lib/lab-queries";
import { fmtDateTime } from "@/lib/opd-queries";
import { useStaff, requireArea } from "@/lib/auth";
import { ageFromDob, canVerify } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/lab/request/$requestId")({
  beforeLoad: requireArea("lab"),
  head: () => ({ meta: [{ title: "Laboratory Request — Two D Medium Clinic" }, { name: "description", content: "Specimens, test processing, results and verification for one laboratory request." }] }),
  component: () => <RequireArea area="lab"><LabRequest /></RequireArea>,
});

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="text-sm font-medium">{children}</div></div>;
}

function LabRequest() {
  const { requestId } = Route.useParams();
  const { data: me } = useStaff();
  const { data: names } = useStaffNames();
  const { data: services } = useServices();
  useLiveTable("lab_request_items", [["lab_req", requestId]]);
  useLiveTable("lab_specimens", [["lab_req", requestId]]);
  const { data: req, isLoading, error, refetch } = useQuery(labRequestQuery(requestId));
  const [busy, setBusy] = useState(false);

  if (isLoading || !me) return <PageLoading />;
  if (error) return <LoadError onRetry={() => refetch()} />;
  if (!req) return <LoadError message="This laboratory request was not found." />;
  const p = req.patients!;
  const isTech = me.roles.includes("laboratory_technician");
  const order = (s: string | undefined) => { const i = LAB_SECTIONS.indexOf(s ?? ""); return i < 0 ? 99 : i; };
  const items = [...req.lab_request_items].sort((a, b) =>
    order(a.lab_tests?.section) - order(b.lab_tests?.section) || (a.lab_tests?.display_order ?? 0) - (b.lab_tests?.display_order ?? 0));
  const accession = Object.fromEntries(req.lab_specimens.map((s) => [s.id, s.accession_number ?? ""]));
  const ids = (s: string) => items.filter((i) => i.status === s).map((i) => i.id);
  const verifiable = items.filter((i) => i.status === "awaiting_verification" &&
    canVerify({ enteredBy: i.lab_results?.entered_by, userId: me.id, canVerifyLab: me.canVerifyLab, canSelfVerify: me.canSelfVerify }));
  const svc = services?.find((s) => s.key === req.visits?.service_key)?.name ?? req.visits?.service_key ?? "—";

  async function bulk(idList: string[], status: string, ok: string) {
    setBusy(true);
    const { error } = await supabase.from("lab_request_items").update({ status } as never).in("id", idList);
    setBusy(false);
    if (error) toast.error(error.message); else toast.success(ok);
    refetch();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Laboratory request ${req.request_number ?? ""}`}
        subtitle="Received from OPD — patient and doctor's request are linked automatically."
        actions={<>
          {req.priority === "urgent" && <StatusBadge status="urgent" label="Urgent" />}
          <StatusBadge status={req.status} />
          <Button variant="outline" asChild><Link to="/lab/report/$requestId" params={{ requestId }}><Printer className="mr-1 h-4 w-4" />Report</Link></Button>
        </>}
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Patient ID"><span className="font-mono">{p.mrn}</span></Info>
          <Info label="Patient name"><Link className="text-primary hover:underline" to="/patients/$patientId" params={{ patientId: p.id }}>{patientName(p)}</Link></Info>
          <Info label="Age / sex"><span className="capitalize">{ageFromDob(p.date_of_birth, new Date(), p.dob_estimated) ?? "—"} · {p.sex}</span></Info>
          <Info label="Encounter / visit">{encounterRef(req.consultation_id)} · {visitRef(req.visits)}</Info>
          <Info label="Service">{svc}</Info>
          <Info label="Requesting clinician">{names?.[req.requested_by ?? ""] ?? "—"}</Info>
          <Info label="Requested">{fmtDateTime(req.created_at)}</Info>
          <Info label="Priority"><span className={req.priority === "urgent" ? "text-destructive" : ""}>{req.priority === "urgent" ? "Urgent" : "Routine"}</span></Info>
          <div className="sm:col-span-2 lg:col-span-4"><Info label="Clinical indication">{req.clinical_notes || <span className="font-normal text-muted-foreground">Not given</span>}</Info></div>
          {p.allergies && <div className="sm:col-span-2 lg:col-span-4 text-sm text-destructive"><b>Allergies:</b> {p.allergies}</div>}
        </CardContent>
      </Card>

      <SpecimenPanel req={req} isTech={isTech} myId={me.id} names={names} onChange={() => refetch()} />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Requested tests ({items.length})</CardTitle>
          {isTech && (
            <div className="flex flex-wrap gap-2">
              {ids("received").length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => bulk(ids("received"), "processing", "Processing started")}>Start processing all received ({ids("received").length})</Button>}
              {ids("entered").length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => bulk(ids("entered"), "awaiting_verification", "Results sent for verification")}>Submit all entered ({ids("entered").length})</Button>}
              {verifiable.length > 0 && <Button size="sm" disabled={busy} onClick={() => bulk(verifiable.map((i) => i.id), "verified", "Results verified and released to OPD")}><ShieldCheck className="mr-1 h-4 w-4" />Verify all I can ({verifiable.length})</Button>}
            </div>
          )}
        </CardHeader>
        <CardContent className="divide-y p-0">
          {items.map((i) => (
            <TestRow key={`${i.id}-${i.status}-${i.lab_results?.entered_at ?? ""}`} item={i} me={me} names={names}
              amendments={req.lab_result_amendments.filter((a) => a.item_id === i.id)}
              accession={i.current_specimen_id ? accession[i.current_specimen_id] : undefined} onChange={() => refetch()} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
