import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, RequireArea } from "@/components/AppShell";
import { CheckInDialog } from "@/components/CheckInDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { usePatientSearch } from "@/components/PatientPicker";
import { supabase } from "@/integrations/supabase/client";
import { patientName, today, useLiveTable, useServices, useStaffNames, VISIT_STATUS_LABEL } from "@/lib/data";
import { requireArea } from "@/lib/auth";
import { friendlyDbError } from "@/lib/patient-schema";

export const Route = createFileRoute("/_authenticated/reception/queue")({
  beforeLoad: requireArea("reception"),
  head: () => ({ meta: [{ title: "Check-in & Queue — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="reception"><Queue /></RequireArea>,
});

function Queue() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const { data: services } = useServices();
  const { data: names } = useStaffNames();
  useLiveTable("visits", [["queue_today"]]);
  const { data: found, isFetching } = usePatientSearch(q);

  const { data: queue, isLoading, error, refetch } = useQuery({
    queryKey: ["queue_today", today()],
    queryFn: async () => {
      const { data, error } = await supabase.from("visits").select("*, patients(mrn, first_name, middle_name, last_name)").eq("queue_date", today()).order("queue_number");
      if (error) throw error;
      return data;
    },
  });
  const rows = (queue ?? []).filter((v) => status === "all" || (status === "active" ? ["waiting", "in_consultation", "awaiting_lab"].includes(v.status) : v.status === status));
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;
  const inQueue = new Set((queue ?? []).filter((v) => ["waiting", "in_consultation", "awaiting_lab"].includes(v.status)).map((v) => v.patient_id));

  async function update(id: string, patch: { status?: "cancelled" | "no_show"; service_key?: string }) {
    const { error } = await supabase.from("visits").update(patch).eq("id", id);
    if (error) toast.error(friendlyDbError(error.message)); else { toast.success("Queue updated"); refetch(); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Check-in & OPD queue" subtitle="Find the patient, choose the service and add them to today's shared OPD waiting list"
        actions={<Button asChild><Link to="/patients/new" search={{ walkin: true }}><UserPlus className="mr-1 h-4 w-4" />New walk-in patient</Link></Button>} />
      <Card>
        <CardHeader><CardTitle className="text-base">Walk-in check-in (existing patient)</CardTitle></CardHeader>
        <CardContent>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" aria-label="Find patient" placeholder="Patient number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-3 divide-y">
            {q.trim().length >= 2 && isFetching && !found && <p className="py-2 text-sm text-muted-foreground">Searching…</p>}
            {found?.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div><span className="font-medium">{patientName(p)}</span> <span className="font-mono text-xs text-muted-foreground">{p.mrn}</span> <span className="text-muted-foreground">{p.phone}</span></div>
                {inQueue.has(p.id) ? <span className="text-xs text-muted-foreground">Already in today's queue</span>
                  : <CheckInDialog patientId={p.id} patientLabel={patientName(p)} onDone={() => setQ("")} />}
              </div>
            ))}
            {q.trim().length >= 2 && found?.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No match. <Link to="/patients/new" search={{ walkin: true }} className="text-primary hover:underline">Register as a new walk-in patient</Link></p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Today's queue ({queue?.length ?? 0})</CardTitle>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Queue filter" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Still in clinic</SelectItem>
              <SelectItem value="all">All</SelectItem>
              {Object.entries(VISIT_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        {error && <div className="px-6 pb-4"><LoadError onRetry={() => refetch()} /></div>}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Patient</TableHead><TableHead>Service</TableHead><TableHead className="hidden md:table-cell">Type</TableHead><TableHead className="hidden md:table-cell">Checked in</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No patients in this list.</TableCell></TableRow>}
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-lg font-bold text-primary">{v.queue_number}</TableCell>
                  <TableCell>{patientName(v.patients)} <div className="font-mono text-xs text-muted-foreground">{v.patients?.mrn}</div></TableCell>
                  <TableCell className="text-sm">
                    {v.status === "waiting" ? (
                      <Select value={v.service_key} onValueChange={(s) => update(v.id, { service_key: s })}>
                        <SelectTrigger aria-label="Change service" className="h-8 w-52"><SelectValue /></SelectTrigger>
                        <SelectContent>{services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : svc(v.service_key)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{v.visit_type === "walk_in" ? "Walk-in" : "Appointment"}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{new Date(v.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<div className="text-xs text-muted-foreground">{names?.[v.checked_in_by ?? ""]}</div></TableCell>
                  <TableCell><StatusBadge status={v.status} /></TableCell>
                  <TableCell className="text-right">
                    {v.status === "waiting" && <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => update(v.id, { status: "no_show" })}>Left / no show</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm("Cancel this visit?") && update(v.id, { status: "cancelled" })}>Cancel</Button>
                    </div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
