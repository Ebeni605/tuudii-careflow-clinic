import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { PatientForm } from "@/components/PatientForm";
import { supabase } from "@/integrations/supabase/client";
import { requireArea } from "@/lib/auth";
import { patientName, useServices } from "@/lib/data";
import { friendlyDbError, toPatientRow, type PatientFormValues } from "@/lib/patient-schema";
import { ageFromDob } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/patients/new")({
  validateSearch: (s: Record<string, unknown>): { walkin?: boolean } => (s["walkin"] ? { walkin: true } : {}),
  beforeLoad: requireArea("reception"),
  head: () => ({ meta: [{ title: "Register Patient — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="reception"><NewPatient /></RequireArea>,
});

type Match = { id: string; mrn: string; first_name: string; middle_name: string | null; last_name: string; sex: string; date_of_birth: string | null; phone: string | null; town: string | null; reason: string };

function NewPatient() {
  const { walkin } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: services } = useServices();
  const [busy, setBusy] = useState(false);
  const [checkIn, setCheckIn] = useState(!!walkin);
  const [service, setService] = useState("");
  const [pending, setPending] = useState<PatientFormValues | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [formKey] = useState(0);

  async function start(v: PatientFormValues) {
    if (checkIn && !service) { toast.error("Choose the service for today's visit, or turn off check-in"); return; }
    setBusy(true);
    const row = toPatientRow(v);
    const { data, error } = await supabase.rpc("find_possible_duplicates", {
      _first: row.first_name, _father: row.middle_name, _phone: row.phone ?? "", _dob: row.date_of_birth as never,
    });
    setBusy(false);
    if (error) { toast.error("Could not check for existing patients: " + error.message); return; }
    if (data && data.length) { setPending(v); setMatches(data as Match[]); return; }
    await register(v);
  }

  async function register(v: PatientFormValues) {
    setBusy(true);
    const { data, error } = await supabase.from("patients").insert(toPatientRow(v) as never).select("id, mrn").single();
    if (error) { setBusy(false); toast.error(friendlyDbError(error.message)); return; }
    let queueMsg = "";
    if (checkIn && service) {
      const { data: visit, error: ve } = await supabase.from("visits").insert({ patient_id: data.id, service_key: service }).select("queue_number").single();
      if (ve) toast.error(`Registered, but check-in failed: ${friendlyDbError(ve.message)}`);
      else queueMsg = ` · queue number ${visit.queue_number}`;
    }
    setBusy(false);
    setPending(null);
    toast.success(`Registered — patient number ${data.mrn}${queueMsg}`);
    qc.invalidateQueries();
    navigate({ to: "/patients/$patientId", params: { patientId: data.id } });
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="Register new patient" subtitle="The patient number (CL-000001…) is created automatically when you save. Existing patients are checked first to avoid duplicates." />
      <Card><CardContent className="p-4 sm:p-5">
        <PatientForm
          key={formKey}
          busy={busy}
          submitLabel={checkIn ? "Register and check in" : "Register patient"}
          onSubmit={start}
          extra={
            <div className="rounded-md border border-primary/30 bg-secondary/50 p-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={checkIn} onCheckedChange={setCheckIn} /> Check in today as a walk-in (adds the patient to the OPD queue)
              </label>
              {checkIn && (
                <div className="mt-3 max-w-md space-y-1.5">
                  <Label>Service for today's visit *</Label>
                  <Select value={service} onValueChange={setService}>
                    <SelectTrigger aria-label="Service for today's visit"><SelectValue placeholder="Select service" /></SelectTrigger>
                    <SelectContent>{services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          }
        />
      </CardContent></Card>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Possible existing patient</DialogTitle>
            <DialogDescription>These records look similar. Open the existing record instead of registering the same person twice.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 divide-y overflow-auto rounded border">
            {matches.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <div className="font-medium">{patientName(m)} <span className="font-mono text-xs text-muted-foreground">{m.mrn}</span></div>
                  <div className="text-xs text-muted-foreground capitalize">{m.sex} · {ageFromDob(m.date_of_birth) ?? "age unknown"} · {m.phone ?? "no phone"} · {m.town ?? ""}</div>
                  <div className="text-xs text-destructive">Match: {m.reason}</div>
                </div>
                <Button size="sm" variant="outline" asChild><Link to="/patients/$patientId" params={{ patientId: m.id }}>Open this patient</Link></Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>Back to form</Button>
            <Button disabled={busy} onClick={() => pending && register(pending)}>{busy ? "Saving…" : "None of these — register new patient"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
