import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, TestTube, Truck, PackageCheck, Cog, ShieldCheck, CheckCircle2, RotateCcw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { requireArea, useStaff } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { clinicDayRange, LAB_SECTIONS, LAB_STATUS_LABEL, patientName, today, useLiveTable, useStaffNames } from "@/lib/data";
import { labWorklistQuery, visitRef } from "@/lib/lab-queries";
import { fmtTime } from "@/lib/opd-queries";
import { ageFromDob } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/lab/")({
  beforeLoad: requireArea("lab"),
  head: () => ({ meta: [{ title: "Laboratory Dashboard — Two D Medium Clinic" }, { name: "description", content: "Laboratory requests from OPD, specimens, processing and verification." }] }),
  component: () => <RequireArea area="lab"><LabDashboard /></RequireArea>,
});

const ITEM_STATUSES = ["requested", "collected", "received", "processing", "entered", "awaiting_verification", "verified", "rejected", "cancelled"];

function LabDashboard() {
  const [mode, setMode] = useState<"open" | "day">("open");
  const [day, setDay] = useState(today());
  const [mrn, setMrn] = useState("");
  const [name, setName] = useState("");
  const [section, setSection] = useState("all");
  const [status, setStatus] = useState("all");
  const { data: names } = useStaffNames();
  const { data: me } = useStaff();
  useLiveTable("lab_requests", [["worklist"], ["lab_counts"]]);
  useLiveTable("lab_request_items", [["worklist"], ["lab_counts"]]);

  const range = clinicDayRange(day);
  const { data, isLoading, error, refetch } = useQuery(labWorklistQuery(mode, range.from, range.to));
  const { data: open } = useQuery(labWorklistQuery("open", "", ""));
  const { data: verifiedCount } = useQuery({
    queryKey: ["lab_counts", "verified", day],
    queryFn: async () => {
      const { count } = await supabase.from("lab_request_items").select("id", { count: "exact", head: true })
        .eq("status", "verified").gte("verified_at", range.from).lte("verified_at", range.to);
      return count ?? 0;
    },
  });

  const openItems = (open ?? []).flatMap((r) => r.lab_request_items);
  const n = (s: string[]) => openItems.filter((i) => s.includes(i.status)).length;
  const cards = [
    { label: "New requests", value: (open ?? []).filter((r) => r.status === "requested").length, icon: ClipboardList, filter: "requested", hint: "requests not started" },
    { label: "Awaiting collection", value: n(["requested"]), icon: TestTube, filter: "requested", hint: "tests" },
    { label: "Collected — to receive", value: n(["collected"]), icon: Truck, filter: "collected", hint: "tests" },
    { label: "Samples received", value: n(["received"]), icon: PackageCheck, filter: "received", hint: "tests" },
    { label: "In processing", value: n(["processing", "entered"]), icon: Cog, filter: "processing", hint: "incl. results being entered" },
    { label: "Awaiting verification", value: n(["awaiting_verification"]), icon: ShieldCheck, filter: "awaiting_verification", hint: "tests" },
    { label: "Verified", value: verifiedCount ?? 0, icon: CheckCircle2, filter: "verified", hint: day === today() ? "today" : "on selected date" },
    { label: "Rejected — recollect", value: n(["rejected"]), icon: RotateCcw, filter: "rejected", hint: "specimens to collect again", danger: true },
  ];

  const mrnQ = mrn.trim().toLowerCase();
  const nameQ = name.trim().toLowerCase();
  const rows = [...(data ?? [])]
    .filter((r) => {
      const items = r.lab_request_items.filter((i) => section === "all" || i.lab_tests?.section === section);
      if (!items.length) return false;
      if (status !== "all" && !items.some((i) => (status === "processing" ? ["processing", "entered"].includes(i.status) : i.status === status))) return false;
      if (mrnQ && !r.patients?.mrn.toLowerCase().includes(mrnQ)) return false;
      if (nameQ && !patientName(r.patients).toLowerCase().includes(nameQ)) return false;
      return true;
    })
    .sort((a, b) => (a.priority === "urgent" ? 0 : 1) - (b.priority === "urgent" ? 0 : 1));

  function pick(filter: string) {
    setStatus(filter);
    if (filter === "verified") setMode("day"); else setMode("open");
  }

  return (
    <div>
      <PageHeader
        title="Laboratory dashboard"
        subtitle="Requests arrive here automatically from OPD. Urgent requests are listed first."
        actions={me?.canVerifyLab ? <Button variant="outline" asChild><Link to="/lab/verify"><ShieldCheck className="mr-1 h-4 w-4" />Verification queue</Link></Button> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {cards.map((c) => (
          <button key={c.label} type="button" onClick={() => pick(c.filter)} className="text-left">
            <Card className={`h-full transition hover:border-primary ${status === c.filter ? "border-primary ring-1 ring-primary" : ""}`}>
              <CardContent className="flex items-start gap-2 p-3">
                <c.icon className={`mt-0.5 h-5 w-5 shrink-0 ${c.danger && c.value ? "text-destructive" : "text-primary"}`} />
                <div>
                  <div className={`text-2xl font-bold ${c.danger && c.value ? "text-destructive" : ""}`}>{c.value}</div>
                  <div className="text-xs font-medium leading-tight">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground">{c.hint}</div>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "open" | "day")}>
          <TabsList><TabsTrigger value="open">Open work</TabsTrigger><TabsTrigger value="day">By request date</TabsTrigger></TabsList>
        </Tabs>
        <Input type="date" className="w-40" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Date" disabled={mode === "open"} />
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-40 pl-8" placeholder="Patient ID" value={mrn} onChange={(e) => setMrn(e.target.value)} aria-label="Patient ID" />
        </div>
        <Input className="w-48" placeholder="Patient name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Patient name" />
        <Select value={section} onValueChange={setSection}>
          <SelectTrigger className="w-52" aria-label="Test category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All test categories</SelectItem>
            {LAB_SECTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52" aria-label="Test status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ITEM_STATUSES.map((s) => <SelectItem key={s} value={s}>{LAB_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status !== "all" || section !== "all" || mrn || name) && (
          <Button variant="ghost" size="sm" onClick={() => { setStatus("all"); setSection("all"); setMrn(""); setName(""); }}>Clear filters</Button>
        )}
      </div>

      {isLoading ? <PageLoading /> : error ? <LoadError onRetry={() => refetch()} /> : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead><TableHead>Patient</TableHead><TableHead>Visit</TableHead><TableHead>Requested by</TableHead>
                  <TableHead>Time</TableHead><TableHead>Tests</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No laboratory requests match these filters.</TableCell></TableRow>}
                {rows.map((r) => {
                  const items = r.lab_request_items;
                  const done = items.filter((i) => i.status === "verified" || i.status === "cancelled").length;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-mono text-xs">{r.request_number}</div>
                        <div className="mt-1 flex flex-wrap gap-1">{r.priority === "urgent" && <StatusBadge status="urgent" label="Urgent" />}<StatusBadge status={r.status} /></div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{patientName(r.patients)}</div>
                        <div className="text-xs text-muted-foreground"><span className="font-mono">{r.patients?.mrn}</span> · <span className="capitalize">{r.patients?.sex}</span> · {ageFromDob(r.patients?.date_of_birth ?? null, new Date(), r.patients?.dob_estimated ?? false) ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs">{visitRef(r.visits)}</TableCell>
                      <TableCell className="text-sm">{names?.[r.requested_by ?? ""] ?? "—"}</TableCell>
                      <TableCell className="text-sm">{fmtTime(r.created_at)}</TableCell>
                      <TableCell className="max-w-md">
                        <div className="flex flex-wrap gap-1">
                          {items.map((i) => <StatusBadge key={i.id} status={i.status} label={i.lab_tests?.name ?? "?"} />)}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{done}/{items.length} finished</div>
                      </TableCell>
                      <TableCell className="text-right"><Button size="sm" asChild><Link to="/lab/request/$requestId" params={{ requestId: r.id }}>Open</Link></Button></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
