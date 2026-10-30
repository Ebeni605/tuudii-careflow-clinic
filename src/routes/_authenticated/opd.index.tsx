import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { patientName, today, useLiveTable, useServices } from "@/lib/data";
import { useStaff, requireArea } from "@/lib/auth";
import { ageFromDob } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/opd/")({
  beforeLoad: requireArea("opd"),
  head: () => ({ meta: [{ title: "OPD Queue — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="opd"><OpdQueue /></RequireArea>,
});

function OpdQueue() {
  const [service, setService] = useState("all");
  const { data: services } = useServices();
  const { data: me } = useStaff();
  const navigate = useNavigate();
  const isClinician = me?.roles.includes("clinician");
  useLiveTable("visits", [["opd_queue"]]);
  useLiveTable("lab_request_items", [["opd_queue"]]);

  const { data: queue } = useQuery({
    queryKey: ["opd_queue"],
    queryFn: async () => (await supabase.from("visits").select("*, patients(mrn, first_name, middle_name, last_name, sex, date_of_birth, allergies)")
      .eq("queue_date", today()).in("status", ["waiting", "in_consultation", "awaiting_lab", "completed"]).order("queue_number")).data ?? [],
  });
  const rows = (queue ?? []).filter((v) => service === "all" || v.service_key === service);
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  async function call(id: string) {
    const { error } = await supabase.from("visits").update({ status: "in_consultation" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    navigate({ to: "/opd/visit/$visitId", params: { visitId: id } });
  }

  return (
    <div>
      <PageHeader
        title="OPD queue"
        subtitle="Today's patients checked in by reception"
        actions={
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Patient</TableHead><TableHead>Sex / Age</TableHead><TableHead>Service</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No patients in this queue.</TableCell></TableRow>}
            {rows.map((v) => (
              <TableRow key={v.id} className={v.status === "completed" ? "opacity-60" : ""}>
                <TableCell className="text-lg font-bold text-primary">{v.queue_number}</TableCell>
                <TableCell>
                  <div className="font-medium">{patientName(v.patients)}</div>
                  <div className="font-mono text-xs text-muted-foreground">{v.patients?.mrn}</div>
                  {v.patients?.allergies && <span className="rounded bg-destructive/10 px-1.5 text-xs text-destructive">Allergy</span>}
                </TableCell>
                <TableCell className="capitalize">{v.patients?.sex} · {ageFromDob(v.patients?.date_of_birth ?? null) ?? "—"}</TableCell>
                <TableCell>{svc(v.service_key)}</TableCell>
                <TableCell><StatusBadge status={v.status} /></TableCell>
                <TableCell className="text-right">
                  {v.status === "waiting" && isClinician
                    ? <Button size="sm" onClick={() => call(v.id)}>Call patient</Button>
                    : <Button size="sm" variant="outline" asChild><Link to="/opd/visit/$visitId" params={{ visitId: v.id }}>Open</Link></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
