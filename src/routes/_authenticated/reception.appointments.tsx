import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { requireArea } from "@/lib/auth";
import { CheckInDialog } from "@/components/CheckInDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { patientName, today, useServices } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/reception/appointments")({
  beforeLoad: requireArea("reception"),
  head: () => ({ meta: [{ title: "Appointments — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="reception"><Appointments /></RequireArea>,
});

function Appointments() {
  const [day, setDay] = useState(today());
  const [q, setQ] = useState("");
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [service, setService] = useState("");
  const [time, setTime] = useState("09:00");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const { data: services } = useServices();
  const term = q.trim().replace(/[%,()]/g, "");

  const { data: found } = useQuery({
    queryKey: ["appt_search", term],
    enabled: term.length >= 2 && !patient,
    queryFn: async () => (await supabase.from("patients").select("id, mrn, first_name, middle_name, last_name")
      .or(`first_name.ilike.%${term}%,middle_name.ilike.%${term}%,last_name.ilike.%${term}%,mrn.ilike.%${term}%,phone.ilike.%${term}%`).limit(6)).data ?? [],
  });
  const { data: appts, refetch } = useQuery({
    queryKey: ["appts", day],
    queryFn: async () => (await supabase.from("appointments").select("*, patients(id, mrn, first_name, middle_name, last_name)")
      .gte("scheduled_at", new Date(`${day}T00:00:00`).toISOString()).lt("scheduled_at", new Date(`${day}T23:59:59`).toISOString()).order("scheduled_at")).data ?? [],
  });
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  async function book() {
    if (!patient || !service) { toast.error("Choose a patient and service"); return; }
    const { error } = await supabase.from("appointments").insert({
      patient_id: patient.id, service_key: service, reason: reason || null, scheduled_at: new Date(`${date}T${time}:00`).toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Appointment booked");
    setPatient(null); setQ(""); setReason(""); setDay(date); refetch();
  }
  async function setStatus(id: string, status: "cancelled" | "no_show") {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else refetch();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-3"><PageHeader title="Appointments" /></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Book appointment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Patient</Label>
            {patient ? (
              <div className="flex items-center justify-between rounded border bg-secondary px-3 py-2 text-sm">{patient.label}<Button size="sm" variant="ghost" onClick={() => setPatient(null)}>Change</Button></div>
            ) : (
              <>
                <Input placeholder="Search patient" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="divide-y rounded border empty:hidden">
                  {found?.map((p) => (
                    <button key={p.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => setPatient({ id: p.id, label: `${patientName(p)} · ${p.mrn}` })}>
                      {patientName(p)} <span className="font-mono text-xs text-muted-foreground">{p.mrn}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Service</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
              <SelectContent>{services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></div>
          <Button className="w-full" onClick={book}>Book</Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Schedule</CardTitle>
          <Input type="date" className="w-44" value={day} onChange={(e) => setDay(e.target.value)} />
        </CardHeader>
        <Table>
          <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>Service</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {appts?.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No appointments.</TableCell></TableRow>}
            {appts?.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{new Date(a.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TableCell>
                <TableCell>{patientName(a.patients)}<div className="text-xs text-muted-foreground">{a.reason}</div></TableCell>
                <TableCell>{svc(a.service_key)}</TableCell>
                <TableCell><StatusBadge status={a.status} label={a.status.replace("_", " ")} /></TableCell>
                <TableCell className="text-right">
                  {a.status === "scheduled" && a.patients && <div className="flex justify-end gap-1">
                    {day === today() && <CheckInDialog patientId={a.patients.id} patientLabel={patientName(a.patients)} appointmentId={a.id} defaultService={a.service_key} onDone={() => refetch()} />}
                    <Button size="sm" variant="ghost" onClick={() => setStatus(a.id, "no_show")}>No show</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(a.id, "cancelled")}>Cancel</Button>
                  </div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
