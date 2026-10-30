import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Printer, Pencil, AlertTriangle, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { PatientForm } from "@/components/PatientForm";
import { CheckInDialog } from "@/components/CheckInDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { PrintHeader } from "@/components/ClinicBrand";
import { ClinicalHistory } from "@/components/opd/ClinicalHistory";
import { supabase } from "@/integrations/supabase/client";
import { APPT_STATUS_LABEL, patientName, useServices, useStaffNames } from "@/lib/data";
import { requireArea, useStaff } from "@/lib/auth";
import { fromPatientRow, friendlyDbError, toPatientRow } from "@/lib/patient-schema";
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
  const { data: names } = useStaffNames();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [busy, setBusy] = useState(false);
  const roles = me?.roles ?? [];
  const isReception = canAccess(roles, "reception");
  const isAdmin = roles.includes("admin");
  const seesResults = canAccess(roles, "results");

  const { data: p, error, isLoading, refetch } = useQuery({
    queryKey: ["patient", patientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("patients").select("*").eq("id", patientId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: visits } = useQuery({
    queryKey: ["patient_visits", patientId],
    queryFn: async () => (await supabase.from("visits").select("id, checked_in_at, queue_number, service_key, status, visit_type, checked_in_by").eq("patient_id", patientId).order("checked_in_at", { ascending: false })).data ?? [],
  });
  const { data: appts } = useQuery({
    queryKey: ["patient_appts", patientId],
    queryFn: async () => (await supabase.from("appointments").select("*").eq("patient_id", patientId).order("scheduled_at", { ascending: false })).data ?? [],
  });
  const { data: labs } = useQuery({
    queryKey: ["patient_labs", patientId],
    enabled: seesResults,
    queryFn: async () => (await supabase.from("lab_requests").select("id, request_number, created_at, status").eq("patient_id", patientId).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: history } = useQuery({
    queryKey: ["patient_audit", patientId],
    enabled: isAdmin,
    queryFn: async () => (await supabase.from("audit_log").select("*").eq("table_name", "patients").eq("record_id", patientId).order("changed_at", { ascending: false }).limit(50)).data ?? [],
  });
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  if (isLoading) return <PageLoading />;
  if (error) return <LoadError onRetry={() => refetch()} />;
  if (!p) return <div className="rounded-md border bg-card p-6 text-center text-muted-foreground">Patient not found. <Link to="/patients" className="text-primary hover:underline">Back to patients</Link></div>;
  const age = ageFromDob(p.date_of_birth, new Date(), p.dob_estimated);

  async function archive(nextArchived: boolean) {
    setBusy(true);
    const { error } = await supabase.from("patients").update({ archived: nextArchived, archived_reason: nextArchived ? archiveReason.trim() : null }).eq("id", patientId);
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success(nextArchived ? "Record archived" : "Record restored");
    setArchiveOpen(false); setArchiveReason("");
    qc.invalidateQueries();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={patientName(p)}
        subtitle={`${p.mrn} · ${p.sex} · ${age ?? "age unknown"}`}
        actions={<>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print card</Button>
          {isReception && !p.archived && <Button variant="outline" onClick={() => { setReason(""); setEditing(true); }}><Pencil className="mr-1 h-4 w-4" />Correct details</Button>}
          {isAdmin && (p.archived
            ? <Button variant="outline" disabled={busy} onClick={() => archive(false)}>Restore record</Button>
            : <Button variant="outline" onClick={() => setArchiveOpen(true)}><Archive className="mr-1 h-4 w-4" />Archive</Button>)}
          {isReception && !p.archived && <CheckInDialog patientId={p.id} patientLabel={patientName(p)} />}
        </>}
      />
      {p.archived && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <b>Archived record</b> — {p.archived_reason} ({p.archived_at && new Date(p.archived_at).toLocaleDateString()} by {names?.[p.archived_by ?? ""] ?? "—"}). It cannot be checked in or booked.
        </div>
      )}
      {p.allergies && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> <b>Allergies:</b> {p.allergies}
        </div>
      )}

      <div className="hidden print:block">
        <div className="print-area mx-auto max-w-md rounded border p-4">
          <PrintHeader title="Patient Card" />
          <div className="mt-3 space-y-1 text-sm">
            <div><b>Card no:</b> {p.mrn}</div><div><b>Name:</b> {patientName(p)}</div>
            <div><b>Sex:</b> {p.sex} &nbsp; <b>Age:</b> {age ?? "—"}</div>
            <div><b>Phone:</b> {p.phone ?? "—"}</div>
            <div><b>Registered:</b> {new Date(p.created_at).toLocaleDateString()}</div>
          </div>
        </div>
      </div>

      <div className="no-print grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Demographics</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row k="Patient number" v={p.mrn} />
            <Row k="Father's name" v={p.middle_name} />
            <Row k="Grandfather's name" v={p.last_name} />
            <Row k={p.dob_estimated ? "Date of birth (estimated)" : "Date of birth"} v={p.date_of_birth} />
            <Row k="Phone" v={p.phone} />
            <Row k="Region" v={p.region} /><Row k="Town" v={p.town} /><Row k="Kebele" v={p.kebele} /><Row k="Address" v={p.address} />
            {(p.guardian_name || p.guardian_phone) && <Row k="Guardian" v={[p.guardian_name, p.guardian_relationship && `(${p.guardian_relationship})`, p.guardian_phone].filter(Boolean).join(" ")} />}
            <Row k="Emergency contact" v={[p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(" · ")} />
            <div className="border-t pt-2" />
            <Row k="Registered" v={new Date(p.created_at).toLocaleString()} />
            <Row k="Registered by" v={names?.[p.created_by ?? ""] ?? "—"} />
          </CardContent>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Visit history</CardTitle></CardHeader>
            <CardContent>
              {visits?.length === 0 && <p className="text-sm text-muted-foreground">No visits yet.</p>}
              <div className="divide-y">
                {visits?.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="font-medium">{svc(v.service_key)}</div>
                      <div className="text-xs text-muted-foreground">{new Date(v.checked_in_at).toLocaleString()} · Queue #{v.queue_number} · {v.visit_type === "walk_in" ? "Walk-in" : "Appointment"} · checked in by {names?.[v.checked_in_by ?? ""] ?? "—"}</div>
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
          <Card>
            <CardHeader><CardTitle className="text-base">Appointment history</CardTitle></CardHeader>
            <CardContent>
              {appts?.length === 0 && <p className="text-sm text-muted-foreground">No appointments.</p>}
              <div className="divide-y">
                {appts?.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="font-medium">{new Date(a.scheduled_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · {svc(a.service_key)}</div>
                      <div className="text-xs text-muted-foreground">{a.reason}{a.cancel_reason && ` · Cancelled: ${a.cancel_reason}`}</div>
                    </div>
                    <StatusBadge status={a.status} label={APPT_STATUS_LABEL[a.status]} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          {canAccess(roles, "opd") && <ClinicalHistory patientId={p.id} />}
          {seesResults && (
            <Card>
              <CardHeader><CardTitle className="text-base">Laboratory requests</CardTitle></CardHeader>
              <CardContent>
                {labs?.length === 0 && <p className="text-sm text-muted-foreground">No lab requests.</p>}
                <div className="divide-y">
                  {labs?.map((l) => (
                    <div key={l.id} className="flex items-center justify-between py-2 text-sm">
                      <div><span className="font-mono">{l.request_number}</span> <span className="text-muted-foreground">· {new Date(l.created_at).toLocaleString()}</span></div>
                      <div className="flex items-center gap-3"><StatusBadge status={l.status} /><Link className="text-xs text-primary hover:underline" to="/lab/report/$requestId" params={{ requestId: l.id }}>Report</Link></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {isAdmin && (
            <Card>
              <CardHeader><CardTitle className="text-base">Change history</CardTitle></CardHeader>
              <CardContent className="divide-y text-sm">
                {history?.length === 0 && <p className="text-muted-foreground">No changes recorded.</p>}
                {history?.map((h) => {
                  const d = h.diff as { old?: Record<string, unknown>; new?: Record<string, unknown> } | null;
                  const changed = h.action === "UPDATE" && d?.old && d?.new
                    ? Object.keys(d.new).filter((k) => !["updated_at", "correction_note"].includes(k) && JSON.stringify(d.new![k]) !== JSON.stringify(d.old![k])) : [];
                  return (
                    <div key={h.id} className="py-2">
                      <div><b>{h.action === "INSERT" ? "Registered" : "Corrected"}</b> by {h.user_id ? names?.[h.user_id] ?? "Unknown" : "System"} · {new Date(h.changed_at).toLocaleString()}</div>
                      {changed.length > 0 && <div className="text-xs text-muted-foreground">Changed: {changed.map((k) => k.replace(/_/g, " ")).join(", ")}</div>}
                      {h.action === "UPDATE" && typeof d?.new?.["correction_note"] === "string" && d?.new?.["correction_note"] !== d?.old?.["correction_note"] && <div className="text-xs">Reason: {String(d.new["correction_note"])}</div>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Correct patient details — {p.mrn}</DialogTitle>
            <DialogDescription>The patient number and registration details cannot change. Every correction is recorded with your name and reason.</DialogDescription>
          </DialogHeader>
          <PatientForm
            busy={busy}
            submitLabel="Save correction"
            initial={fromPatientRow(p)}
            extra={
              <div className="space-y-1.5">
                <Label htmlFor="cr">Reason for correction *</Label>
                <Textarea id="cr" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Misspelled father's name; patient showed ID card" />
              </div>
            }
            onSubmit={async (v) => {
              if (!reason.trim()) { toast.error("Give a reason for this correction"); return; }
              setBusy(true);
              const { error } = await supabase.from("patients").update({ ...toPatientRow(v), correction_note: `${reason.trim()} [${new Date().toISOString()}]` } as never).eq("id", p.id);
              setBusy(false);
              if (error) { toast.error(friendlyDbError(error.message)); return; }
              toast.success("Patient details corrected");
              setEditing(false);
              qc.invalidateQueries({ queryKey: ["patient", patientId] });
              qc.invalidateQueries({ queryKey: ["patient_audit", patientId] });
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {p.mrn}?</DialogTitle>
            <DialogDescription>Archived records are hidden from search and cannot be checked in. Nothing is deleted, and the record can be restored.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="ar">Reason *</Label><Textarea id="ar" rows={2} maxLength={300} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="e.g. Duplicate of CL-000123" /></div>
          <Button variant="destructive" disabled={busy || !archiveReason.trim()} onClick={() => archive(true)}>Archive record</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right">{v || "—"}</span></div>;
}
