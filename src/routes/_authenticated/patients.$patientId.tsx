import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Printer, Pencil, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { PatientForm, toPatientRow } from "@/components/PatientForm";
import { CheckInDialog } from "@/components/CheckInDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { PrintHeader } from "@/components/ClinicBrand";
import { supabase } from "@/integrations/supabase/client";
import { patientName, useServices } from "@/lib/data";
import { useStaff, requireArea } from "@/lib/auth";
import { ageFromDob, canAccess } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/patients/$patientId")({
  beforeLoad: requireArea("patients"),
  head: () => ({ meta: [{ title: "Patient Record — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="patients"><PatientProfile /></RequireArea>,
});

function PatientProfile() {
  const { patientId } = Route.useParams();
  const { data: me } = useStaff();
  const { data: services } = useServices();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const roles = me?.roles ?? [];
  const isReception = canAccess(roles, "reception");
  const isClinical = canAccess(roles, "opd") || canAccess(roles, "lab");

  const { data: p } = useQuery({
    queryKey: ["patient", patientId],
    queryFn: async () => (await supabase.from("patients").select("*").eq("id", patientId).single()).data,
  });
  const { data: visits } = useQuery({
    queryKey: ["patient_visits", patientId],
    queryFn: async () => (await supabase.from("visits").select("*").eq("patient_id", patientId).order("checked_in_at", { ascending: false })).data ?? [],
  });
  const { data: labs } = useQuery({
    queryKey: ["patient_labs", patientId],
    enabled: isClinical,
    queryFn: async () => (await supabase.from("lab_requests").select("id, request_number, created_at, status, visit_id").eq("patient_id", patientId).order("created_at", { ascending: false })).data ?? [],
  });
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  if (!p) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        title={patientName(p)}
        subtitle={`${p.mrn} · ${p.sex} · ${ageFromDob(p.date_of_birth) ?? "age unknown"}`}
        actions={<>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print card</Button>
          {isReception && <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>}
          {isReception && <CheckInDialog patientId={p.id} patientLabel={patientName(p)} />}
        </>}
      />
      {p.allergies && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> <b>Allergies:</b> {p.allergies}
        </div>
      )}

      {/* Printable patient card */}
      <div className="hidden print:block">
        <div className="print-area mx-auto max-w-md rounded border p-4">
          <PrintHeader title="Patient Card" />
          <div className="mt-3 space-y-1 text-sm">
            <div><b>Card no:</b> {p.mrn}</div><div><b>Name:</b> {patientName(p)}</div>
            <div><b>Sex:</b> {p.sex} &nbsp; <b>Age:</b> {ageFromDob(p.date_of_birth) ?? "—"}</div>
            <div><b>Phone:</b> {p.phone ?? "—"}</div>
          </div>
        </div>
      </div>

      <div className="no-print grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row k="Patient ID" v={p.mrn} /><Row k="Date of birth" v={p.date_of_birth} /><Row k="Phone" v={p.phone} />
            <Row k="Kebele" v={p.kebele} /><Row k="Woreda" v={p.woreda} /><Row k="Address" v={p.address} />
            <Row k="Emergency contact" v={[p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(" · ")} />
            <Row k="Registered" v={new Date(p.created_at).toLocaleDateString()} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Visit history</CardTitle></CardHeader>
          <CardContent>
            {visits?.length === 0 && <p className="text-sm text-muted-foreground">No visits yet.</p>}
            <div className="divide-y">
              {visits?.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <div className="font-medium">{svc(v.service_key)}</div>
                    <div className="text-xs text-muted-foreground">{new Date(v.checked_in_at).toLocaleString()} · Queue #{v.queue_number}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={v.status} />
                    {canAccess(roles, "opd") && <Link className="text-xs text-primary hover:underline" to="/opd/visit/$visitId" params={{ visitId: v.id }}>Open</Link>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        {isClinical && (
          <Card className="lg:col-span-3">
            <CardHeader><CardTitle className="text-base">Laboratory requests</CardTitle></CardHeader>
            <CardContent>
              {labs?.length === 0 && <p className="text-sm text-muted-foreground">No lab requests.</p>}
              <div className="divide-y">
                {labs?.map((l) => (
                  <div key={l.id} className="flex items-center justify-between py-2 text-sm">
                    <div><span className="font-mono">{l.request_number}</span> <span className="text-muted-foreground">· {new Date(l.created_at).toLocaleString()}</span></div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={l.status} />
                      <Link className="text-xs text-primary hover:underline" to="/lab/report/$requestId" params={{ requestId: l.id }}>Report</Link>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Edit patient — {p.mrn}</DialogTitle></DialogHeader>
          <PatientForm
            busy={busy}
            submitLabel="Save changes"
            initial={Object.fromEntries(Object.entries(p).map(([k, val]) => [k, val ?? ""])) as never}
            onSubmit={async (v) => {
              setBusy(true);
              const { error } = await supabase.from("patients").update(toPatientRow(v)).eq("id", p.id);
              setBusy(false);
              if (error) { toast.error(error.message); return; }
              toast.success("Patient updated");
              setEditing(false);
              qc.invalidateQueries({ queryKey: ["patient", patientId] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right">{v || "—"}</span></div>;
}
