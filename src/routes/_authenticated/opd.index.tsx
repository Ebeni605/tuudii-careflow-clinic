import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, FlaskConical, Search, Stethoscope, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { patientName, today, useLiveTable, useServices, VISIT_STATUS_LABEL } from "@/lib/data";
import { fmtTime } from "@/lib/opd-queries";
import { useStaff, requireArea } from "@/lib/auth";
import { ageFromDob } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/opd/")({
  beforeLoad: requireArea("opd"),
  head: () => ({ meta: [{ title: "OPD Dashboard — Two D Medium Clinic" }, { name: "description", content: "OPD queue, consultations in progress and laboratory follow-up." }] }),
  component: () => <RequireArea area="opd"><OpdDashboard /></RequireArea>,
});

const STATUS_FILTERS = ["waiting", "in_consultation", "awaiting_lab", "ready_for_review", "completed", "cancelled", "no_show"];

function OpdDashboard() {
  const [date, setDate] = useState(today());
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const { data: services } = useServices();
  const { data: me } = useStaff();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isClinician = !!me?.roles.includes("clinician");
  useLiveTable("visits", [["opd_queue"]]);
  useLiveTable("lab_request_items", [["opd_queue"]]);

  const { data: visits, isLoading, error, refetch } = useQuery({
    queryKey: ["opd_queue", date],
    queryFn: async () => {
      const { data, error } = await supabase.from("visits")
        .select("*, patients(mrn, first_name, middle_name, last_name, sex, date_of_birth, dob_estimated, allergies), consultations(status)")
        .eq("queue_date", date).order("queue_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const all = visits ?? [];
  const count = (s: string[]) => all.filter((v) => s.includes(v.status)).length;
  const stats = [
    { label: "Waiting", value: count(["waiting"]), icon: Clock, filter: "waiting" },
    { label: "In consultation", value: count(["in_consultation"]), icon: Stethoscope, filter: "in_consultation" },
    { label: "Pending laboratory", value: count(["awaiting_lab"]), icon: FlaskConical, filter: "awaiting_lab" },
    { label: "Ready for review", value: count(["ready_for_review"]), icon: ClipboardCheck, filter: "ready_for_review" },
    { label: "Completed", value: count(["completed"]), icon: CheckCircle2, filter: "completed" },
  ];
  const byService = (services ?? []).map((s) => ({ ...s, n: all.filter((v) => v.service_key === s.key && v.status !== "cancelled").length }));
  const needle = q.trim().toLowerCase();
  const rows = all.filter((v) =>
    (service === "all" || v.service_key === service) &&
    (status === "all" || (status === "open" ? !["completed", "cancelled", "no_show"].includes(v.status) : v.status === status)) &&
    (!needle || v.patients?.mrn.toLowerCase().includes(needle) || patientName(v.patients).toLowerCase().includes(needle)));
  const svc = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  async function call(id: string) {
    const { data, error } = await supabase.from("visits").update({ status: "in_consultation" }).eq("id", id).eq("status", "waiting").select("id");
    if (error) { toast.error(error.message); return; }
    if (!data?.length) toast.info("This patient was already called by another clinician.");
    qc.invalidateQueries({ queryKey: ["opd_queue"] });
    navigate({ to: "/opd/visit/$visitId", params: { visitId: id } });
  }

  return (
    <div>
      <PageHeader title="OPD dashboard" subtitle="Patients come here automatically when Reception checks them in." />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <button key={s.label} type="button" onClick={() => setStatus(s.filter)} className="text-left">
            <Card className={status === s.filter ? "border-primary ring-1 ring-primary" : ""}>
              <CardContent className="flex items-center gap-3 p-3">
                <s.icon className="h-5 w-5 text-primary" />
                <div><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visits by service</div>
          <div className="flex flex-wrap gap-2">
            {byService.map((s) => (
              <button key={s.key} type="button" onClick={() => setService(service === s.key ? "all" : s.key)}
                className={`rounded-full border px-3 py-1 text-xs ${service === s.key ? "border-primary bg-primary text-primary-foreground" : "bg-secondary/50 hover:bg-secondary"}`}>
                {s.name} <b className="ml-1">{s.n}</b>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="mb-3 grid gap-2 md:grid-cols-[1fr_170px_240px_190px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search patient ID or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patient ID or name" />
        </div>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
        <Select value={service} onValueChange={setService}>
          <SelectTrigger aria-label="Service"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Still open</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{VISIT_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <PageLoading /> : error ? <LoadError onRetry={() => refetch()} /> : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visit #</TableHead><TableHead>Patient ID</TableHead><TableHead>Patient</TableHead><TableHead>Sex / Age</TableHead>
                  <TableHead>Service</TableHead><TableHead>Checked in</TableHead><TableHead>Status</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No patients match these filters.</TableCell></TableRow>}
                {rows.map((v) => (
                  <TableRow key={v.id} className={["completed", "cancelled", "no_show"].includes(v.status) ? "opacity-60" : ""}>
                    <TableCell className="text-lg font-bold text-primary">{v.queue_number}</TableCell>
                    <TableCell className="font-mono text-xs">{v.patients?.mrn}</TableCell>
                    <TableCell>
                      <div className="font-medium">{patientName(v.patients)}</div>
                      {v.patients?.allergies && <span className="rounded bg-destructive/10 px-1.5 text-xs text-destructive">Allergy</span>}
                    </TableCell>
                    <TableCell className="capitalize">{v.patients?.sex} · {ageFromDob(v.patients?.date_of_birth ?? null, new Date(), v.patients?.dob_estimated ?? false) ?? "—"}</TableCell>
                    <TableCell className="text-sm">{svc(v.service_key)}</TableCell>
                    <TableCell className="text-sm">{fmtTime(v.checked_in_at)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={v.status} />
                        {v.consultations && v.status !== "completed" && <span className="text-[11px] text-muted-foreground">{v.consultations.status === "signed" ? "Note signed" : "Draft note"}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {v.status === "waiting" && isClinician
                        ? <Button size="sm" onClick={() => call(v.id)}>Start consultation</Button>
                        : <Button size="sm" variant="outline" asChild><Link to="/opd/visit/$visitId" params={{ visitId: v.id }}>{v.status === "ready_for_review" ? "Review results" : "Open"}</Link></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
