import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, RequireArea } from "@/components/AppShell";
import { CheckInDialog } from "@/components/CheckInDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { PatientPicker, type PickedPatient } from "@/components/PatientPicker";
import { supabase } from "@/integrations/supabase/client";
import { APPT_STATUS_LABEL, clinicDayRange, patientName, today, useLiveTable, useServices } from "@/lib/data";
import { requireArea } from "@/lib/auth";
import { friendlyDbError } from "@/lib/patient-schema";

export const Route = createFileRoute("/_authenticated/reception/appointments")({
  beforeLoad: requireArea("reception"),
  head: () => ({ meta: [{ title: "Appointments — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="reception"><Appointments /></RequireArea>,
});

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Addis_Ababa", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
};
const fromLocal = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`).toISOString();

type Appt = { id: string; patient_id: string; service_key: string; scheduled_at: string; reason: string | null; status: string; cancel_reason: string | null; patients: { id: string; mrn: string; first_name: string; middle_name: string | null; last_name: string } | null };

function Appointments() {
  const [day, setDay] = useState(today());
  const [status, setStatus] = useState("all");
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [service, setService] = useState("");
  const [time, setTime] = useState("09:00");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Appt | null>(null);
  const [cancelling, setCancelling] = useState<Appt | null>(null);
  const { data: services } = useServices();
  const qc = useQueryClient();
  useLiveTable("visits", [["appts"]]);
  useLiveTable("appointments" as never, [["appts"]]);

  const { data: appts, isLoading, error, refetch } = useQuery({
    queryKey: ["appts", day],
    queryFn: async () => {
      const r = clinicDayRange(day);
      const { data, error } = await supabase.from("appointments").select("*, patients(id, mrn, first_name, middle_name, last_name)")
        .gte("scheduled_at", r.from).lte("scheduled_at", r.to).order("scheduled_at");
      if (error) throw error;
      return data as Appt[];
    },
  });
  const rows = (appts ?? []).filter((a) => status === "all" || a.status === status);
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["appts"] }); qc.invalidateQueries({ queryKey: ["reception_dash"] }); };

  async function slotWarning(when: string, svcKey: string, excludeId?: string) {
    const { count } = await supabase.from("appointments").select("id", { count: "exact", head: true })
      .eq("scheduled_at", when).eq("service_key", svcKey).eq("status", "scheduled").neq("id", excludeId ?? "00000000-0000-0000-0000-000000000000");
    return (count ?? 0) > 0 ? !confirm(`Another patient is already booked for ${svc(svcKey)} at this exact time. Book anyway?`) : false;
  }

  async function book() {
    if (!patient) { toast.error("Choose a patient"); return; }
    if (!service) { toast.error("Choose a service"); return; }
    if (!date || !time) { toast.error("Choose date and time"); return; }
    const when = fromLocal(date, time);
    if (await slotWarning(when, service)) return;
    setBusy(true);
    const { error } = await supabase.from("appointments").insert({ patient_id: patient.id, service_key: service, reason: reason.trim() || null, scheduled_at: when });
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success(`Appointment booked for ${patient.label}`);
    setPatient(null); setReason(""); setDay(date); refresh();
  }

  async function setNoShow(a: Appt) {
    const { error } = await supabase.from("appointments").update({ status: "no_show" }).eq("id", a.id);
    if (error) toast.error(friendlyDbError(error.message)); else { toast.success("Marked as no show"); refresh(); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-3"><PageHeader title="Appointments" subtitle="Book, change, cancel and check in appointments. One active appointment per patient per day." /></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Book appointment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label>Patient *</Label><PatientPicker value={patient} onChange={setPatient} /></div>
          <div className="space-y-1.5">
            <Label>Service *</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger aria-label="Service"><SelectValue placeholder="Select service" /></SelectTrigger>
              <SelectContent>{services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Date *</Label><Input type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Time *</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Reason for visit</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
          <Button className="w-full" onClick={book} disabled={busy}>{busy ? "Booking…" : "Book appointment"}</Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Schedule</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Status filter" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(APPT_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" aria-label="Schedule date" className="w-44" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
        </CardHeader>
        {error && <div className="px-6 pb-4"><LoadError onRetry={() => refetch()} /></div>}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>Service</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No appointments for this day.</TableCell></TableRow>}
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-semibold">{toLocalInput(a.scheduled_at).time}</TableCell>
                  <TableCell>{patientName(a.patients)} <span className="font-mono text-xs text-muted-foreground">{a.patients?.mrn}</span>
                    <div className="text-xs text-muted-foreground">{a.reason}{a.cancel_reason && ` · Cancelled: ${a.cancel_reason}`}</div></TableCell>
                  <TableCell className="text-sm">{svc(a.service_key)}</TableCell>
                  <TableCell><StatusBadge status={a.status} label={APPT_STATUS_LABEL[a.status]} /></TableCell>
                  <TableCell className="text-right">
                    {a.status === "scheduled" && a.patients && <div className="flex flex-wrap justify-end gap-1">
                      {day === today() && <CheckInDialog patientId={a.patients.id} patientLabel={patientName(a.patients)} appointmentId={a.id} defaultService={a.service_key} onDone={refresh} />}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                      {day <= today() && <Button size="sm" variant="ghost" onClick={() => setNoShow(a)}>No show</Button>}
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(a)}>Cancel</Button>
                    </div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {editing && <EditDialog appt={editing} onClose={() => setEditing(null)} onSaved={refresh} slotWarning={slotWarning} />}
      {cancelling && <CancelDialog appt={cancelling} onClose={() => setCancelling(null)} onSaved={refresh} />}
    </div>
  );
}

function EditDialog({ appt, onClose, onSaved, slotWarning }: { appt: Appt; onClose: () => void; onSaved: () => void; slotWarning: (w: string, s: string, id?: string) => Promise<boolean> }) {
  const { data: services } = useServices();
  const init = toLocalInput(appt.scheduled_at);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [service, setService] = useState(appt.service_key);
  const [reason, setReason] = useState(appt.reason ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    const when = fromLocal(date, time);
    if (when !== appt.scheduled_at || service !== appt.service_key) { if (await slotWarning(when, service, appt.id)) return; }
    setBusy(true);
    const { error } = await supabase.from("appointments").update({ scheduled_at: when, service_key: service, reason: reason.trim() || null }).eq("id", appt.id);
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success("Appointment updated"); onSaved(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit appointment</DialogTitle><DialogDescription>{patientName(appt.patients)} · {appt.patients?.mrn}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Select value={service} onValueChange={setService}>
            <SelectTrigger aria-label="Service"><SelectValue /></SelectTrigger>
            <SelectContent>{services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" aria-label="Date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            <Input type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason for visit" />
          <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ appt, onClose, onSaved }: { appt: Appt; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function cancel() {
    setBusy(true);
    const { error } = await supabase.from("appointments").update({ status: "cancelled", cancel_reason: reason.trim() }).eq("id", appt.id);
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success("Appointment cancelled"); onSaved(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel appointment?</DialogTitle><DialogDescription>{patientName(appt.patients)} · {new Date(appt.scheduled_at).toLocaleString()}</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="cr">Reason *</Label><Textarea id="cr" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <Button variant="destructive" disabled={busy || !reason.trim()} onClick={cancel}>Cancel appointment</Button>
      </DialogContent>
    </Dialog>
  );
}
