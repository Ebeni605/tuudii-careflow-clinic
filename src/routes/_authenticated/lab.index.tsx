import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { patientName, today, useLiveTable, useStaffNames } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/lab/")({
  head: () => ({ meta: [{ title: "Lab Worklist — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="lab"><Worklist /></RequireArea>,
});

function Worklist() {
  const [tab, setTab] = useState("open");
  const [day, setDay] = useState(today());
  const { data: names } = useStaffNames();
  useLiveTable("lab_requests", [["worklist"]]);
  useLiveTable("lab_request_items", [["worklist"]]);

  const { data } = useQuery({
    queryKey: ["worklist", tab, day],
    queryFn: async () => {
      let q = supabase.from("lab_requests").select("*, patients(mrn, first_name, middle_name, last_name, sex), lab_request_items(status)").order("created_at", { ascending: false }).limit(200);
      if (tab === "open") q = q.in("status", ["requested", "in_progress"]);
      else q = q.gte("created_at", new Date(`${day}T00:00:00`).toISOString()).lte("created_at", new Date(`${day}T23:59:59`).toISOString());
      return (await q).data ?? [];
    },
  });
  const rows = [...(data ?? [])].sort((a, b) => (a.priority === "urgent" ? 0 : 1) - (b.priority === "urgent" ? 0 : 1));

  return (
    <div>
      <PageHeader title="Laboratory worklist" subtitle="Requests sent from OPD. Urgent requests are listed first." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="day">By date</TabsTrigger></TabsList></Tabs>
        {tab === "day" && <Input type="date" className="w-44" value={day} onChange={(e) => setDay(e.target.value)} />}
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Patient</TableHead><TableHead>Requested by</TableHead><TableHead>Time</TableHead><TableHead>Progress</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">No requests.</TableCell></TableRow>}
            {rows.map((r) => {
              const items = r.lab_request_items ?? [];
              const done = items.filter((i) => i.status === "verified" || i.status === "rejected").length;
              const toVerify = items.filter((i) => i.status === "resulted").length;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.request_number} {r.priority === "urgent" && <StatusBadge status="urgent" label="Urgent" />}</TableCell>
                  <TableCell>{patientName(r.patients)}<div className="font-mono text-xs text-muted-foreground">{r.patients?.mrn}</div></TableCell>
                  <TableCell>{names?.[r.requested_by ?? ""] ?? "—"}</TableCell>
                  <TableCell>{new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TableCell>
                  <TableCell className="text-sm">{done}/{items.length} done{toVerify > 0 && <span className="ml-1 text-primary">· {toVerify} to verify</span>}</TableCell>
                  <TableCell><StatusBadge status={r.status} label={r.status.replace("_", " ")} /></TableCell>
                  <TableCell className="text-right"><Button size="sm" asChild><Link to="/lab/request/$requestId" params={{ requestId: r.id }}>Open</Link></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
