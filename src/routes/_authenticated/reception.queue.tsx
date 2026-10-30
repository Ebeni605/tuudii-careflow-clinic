import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { requireArea } from "@/lib/auth";
import { CheckInDialog } from "@/components/CheckInDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { patientName, today, useLiveTable, useServices } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/reception/queue")({
  beforeLoad: requireArea("reception"),
  head: () => ({ meta: [{ title: "Check-in & Queue — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="reception"><Queue /></RequireArea>,
});

function Queue() {
  const [q, setQ] = useState("");
  const { data: services } = useServices();
  useLiveTable("visits", [["queue_today"]]);
  const term = q.trim().replace(/[%,()]/g, "");

  const { data: found } = useQuery({
    queryKey: ["checkin_search", term],
    enabled: term.length >= 2,
    queryFn: async () => (await supabase.from("patients").select("id, mrn, first_name, middle_name, last_name, phone")
      .or(`first_name.ilike.%${term}%,middle_name.ilike.%${term}%,last_name.ilike.%${term}%,mrn.ilike.%${term}%,phone.ilike.%${term}%`).limit(8)).data ?? [],
  });
  const { data: queue, refetch } = useQuery({
    queryKey: ["queue_today"],
    queryFn: async () => (await supabase.from("visits").select("*, patients(mrn, first_name, middle_name, last_name)").eq("queue_date", today()).order("queue_number")).data ?? [],
  });
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  async function setStatus(id: string, status: "cancelled" | "no_show") {
    const { error } = await supabase.from("visits").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else refetch();
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Check-in & patient queue" subtitle="Find the patient, choose the service, and add them to today's OPD queue" />
      <Card>
        <CardHeader><CardTitle className="text-base">Walk-in check-in</CardTitle></CardHeader>
        <CardContent>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name, patient ID or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-3 divide-y">
            {found?.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                <div><span className="font-medium">{patientName(p)}</span> <span className="font-mono text-xs text-muted-foreground">{p.mrn}</span> <span className="text-muted-foreground">{p.phone}</span></div>
                <CheckInDialog patientId={p.id} patientLabel={patientName(p)} onDone={() => setQ("")} />
              </div>
            ))}
            {term.length >= 2 && found?.length === 0 && <p className="py-2 text-sm text-muted-foreground">No match. Register the patient first.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Today's queue ({queue?.length ?? 0})</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Patient</TableHead><TableHead>Service</TableHead><TableHead>Type</TableHead><TableHead>Checked in</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {queue?.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">No patients checked in today.</TableCell></TableRow>}
            {queue?.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="text-lg font-bold text-primary">{v.queue_number}</TableCell>
                <TableCell>{patientName(v.patients)} <span className="font-mono text-xs text-muted-foreground">{v.patients?.mrn}</span></TableCell>
                <TableCell>{svc(v.service_key)}</TableCell>
                <TableCell className="capitalize">{v.visit_type.replace("_", "-")}</TableCell>
                <TableCell>{new Date(v.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TableCell>
                <TableCell><StatusBadge status={v.status} /></TableCell>
                <TableCell className="text-right">
                  {v.status === "waiting" && <>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(v.id, "no_show")}>No show</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(v.id, "cancelled")}>Cancel</Button>
                  </>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
