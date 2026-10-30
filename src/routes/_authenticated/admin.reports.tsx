import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Printer, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { PrintHeader } from "@/components/ClinicBrand";
import { BarList, Pager, ReportTable, StatGrid } from "@/components/reports/ReportKit";
import { supabase } from "@/integrations/supabase/client";
import { requireArea } from "@/lib/auth";
import { APPT_STATUS_LABEL, LAB_STATUS_LABEL, VISIT_STATUS_LABEL } from "@/lib/data";
import { fmtDateTime } from "@/lib/opd-queries";
import { defaultRange, downloadCsv, searchDate, fmtMinutes, pct, rangeProblem, toCsv } from "@/lib/reports";
import { money, PAYMENT_METHOD_LABEL } from "@/lib/billing";
import { ROLE_LABELS, type AppRole } from "@/lib/workflow";

const TABS = {
  registrations: "Patient registrations",
  attendance: "OPD attendance",
  services: "Clinical services",
  lab_volume: "Laboratory test volume",
  lab_tat: "Lab turnaround & pending",
  appointments: "Appointments & queue",
  staff: "Staff activity",
  billing: "Billing (optional)",
} as const;
type Tab = keyof typeof TABS;

type Search = { tab?: Tab | undefined; from?: string | undefined; to?: string | undefined };

export const Route = createFileRoute("/_authenticated/admin/reports")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tab: typeof s["tab"] === "string" && s["tab"] in TABS ? (s["tab"] as Tab) : undefined,
    from: searchDate(s["from"]),
    to: searchDate(s["to"]),
  }),
  beforeLoad: requireArea("admin"),
  head: () => ({
    meta: [
      { title: "Reports — Two D Medium Clinic" },
      { name: "description", content: "Management reports for registrations, OPD, services, laboratory, queue, staff activity and billing." },
    ],
  }),
  component: () => <RequireArea area="admin"><Reports /></RequireArea>,
});

const PAGE = 50;
const n = (v: unknown) => Number(v ?? 0);
const num = (v: unknown) => String(n(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

function Reports() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/reports" });
  const def = defaultRange();
  const from = search.from ?? def.from;
  const to = search.to ?? def.to;
  const tab: Tab = search.tab ?? "registrations";
  const [draft, setDraft] = useState({ from, to });
  const problem = rangeProblem(draft.from, draft.to);

  function apply() {
    if (problem) { toast.error(problem); return; }
    navigate({ search: (p) => ({ ...p, from: draft.from, to: draft.to }) });
  }

  return (
    <div>
      <div className="no-print"><PageHeader title="Reports" subtitle="Live figures from the clinic database. Aggregate reports show patient numbers only, never names or phone numbers."
        actions={<Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print / save as PDF</Button>} /></div>

      <Card className="no-print mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label>Report</Label>
            <Select value={tab} onValueChange={(v) => navigate({ search: (p) => ({ ...p, tab: v as Tab }) })}>
              <SelectTrigger aria-label="Report"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(TABS) as Tab[]).map((k) => <SelectItem key={k} value={k}>{TABS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="rf">From</Label><Input id="rf" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="rt">To</Label><Input id="rt" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></div>
          <Button onClick={apply} disabled={!!problem}>Show</Button>
          {problem && <p className="w-full text-sm text-destructive">{problem}</p>}
        </CardContent>
      </Card>

      <div className="print-area space-y-4">
        <div className="hidden print:block">
          <PrintHeader title={TABS[tab]} />
          <p className="mt-2 text-sm">Period: {from} to {to} · Printed {new Date().toLocaleString()}</p>
        </div>
        <h2 className="text-lg font-bold print:hidden">{TABS[tab]} <span className="text-sm font-normal text-muted-foreground">· {from} to {to}</span></h2>
        {tab === "registrations" && <Registrations from={from} to={to} />}
        {tab === "attendance" && <Attendance from={from} to={to} />}
        {tab === "services" && <Services from={from} to={to} />}
        {tab === "lab_volume" && <LabVolume from={from} to={to} />}
        {tab === "lab_tat" && <LabTurnaround from={from} to={to} />}
        {tab === "appointments" && <Appointments from={from} to={to} />}
        {tab === "staff" && <StaffActivity from={from} to={to} />}
        {tab === "billing" && <Billing from={from} to={to} />}
      </div>
    </div>
  );
}

type R = { from: string; to: string };
type Counted = { label: string; count: number };

function useReport<T>(name: string, args: Record<string, unknown>) {
  return useQuery({ queryKey: ["report", name, args], queryFn: () => rpc<T>(name, args), staleTime: 30_000 });
}

function State({ q, children }: { q: { isLoading: boolean; error: unknown; refetch: () => void }; children: () => React.ReactNode }) {
  if (q.isLoading) return <PageLoading label="Building report…" />;
  if (q.error) return <LoadError message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  return <>{children()}</>;
}

// 1 ---------------------------------------------------------------------------
type RegRow = { mrn: string; registered_at: string; sex: string; age_band: string; region: string; registered_by: string; archived: boolean };
type Reg = { total: number; by_day: { day: string; count: number }[]; by_sex: Counted[]; by_age: Counted[]; by_region: Counted[]; rows: RegRow[] };

function Registrations({ from, to }: R) {
  const [offset, setOffset] = useState(0);
  const q = useReport<Reg>("report_registrations", { _from: from, _to: to, _limit: PAGE, _offset: offset });
  async function exportAll() {
    const all: RegRow[] = [];
    for (let o = 0; o < (q.data?.total ?? 0); o += 500) {
      const r = await rpc<Reg>("report_registrations", { _from: from, _to: to, _limit: 500, _offset: o });
      all.push(...r.rows);
    }
    downloadCsv(`registrations_${from}_${to}`, toCsv(all, regCols));
  }
  return (
    <State q={q}>{() => {
      const d = q.data!;
      return (
        <>
          <StatGrid items={[
            { label: "Patients registered", value: d.total },
            { label: "Female", value: d.by_sex.find((s) => s.label === "female")?.count ?? 0 },
            { label: "Male", value: d.by_sex.find((s) => s.label === "male")?.count ?? 0 },
            { label: "Children under 5", value: d.by_age.filter((a) => a.label === "Under 1" || a.label === "1–4").reduce((s, a) => s + a.count, 0) },
            { label: "Days with registrations", value: d.by_day.length },
          ]} />
          <div className="grid gap-4 lg:grid-cols-3">
            <BarList title="By sex" items={d.by_sex.map((s) => ({ label: s.label === "female" ? "Female" : "Male", value: s.count }))} />
            <BarList title="By age group (at registration)" items={d.by_age.map((s) => ({ label: s.label, value: s.count }))} />
            <BarList title="By region" items={d.by_region.map((s) => ({ label: s.label, value: s.count }))} />
          </div>
          <ReportTable title="Registrations per day" csvName={`registrations_by_day_${from}_${to}`} rows={d.by_day}
            columns={[{ key: "day", label: "Date" }, { key: "count", label: "Registered", align: "right" }]} />
          <ReportTable title="Registered patients (patient number only)" csvName={`registrations_page_${from}_${to}`} rows={d.rows} columns={regCols}
            footer={<div className="flex flex-wrap items-center justify-between gap-2">
              <Pager offset={offset} limit={PAGE} total={d.total} onChange={setOffset} />
              <Button size="sm" variant="outline" disabled={!d.total} onClick={exportAll}><Download className="mr-1 h-3.5 w-3.5" />Export all {d.total}</Button>
            </div>} />
        </>
      );
    }}</State>
  );
}
const regCols = [
  { key: "mrn", label: "Patient no." },
  { key: "registered_at", label: "Registered", format: (v: unknown) => fmtDateTime(v as string) },
  { key: "sex", label: "Sex", format: (v: unknown) => (v === "female" ? "Female" : "Male") },
  { key: "age_band", label: "Age group" },
  { key: "region", label: "Region" },
  { key: "registered_by", label: "Registered by" },
  { key: "archived", label: "Archived", format: (v: unknown) => (v ? "Yes" : "No") },
] as { key: keyof RegRow & string; label: string; format?: (v: unknown) => string }[];

// 2 ---------------------------------------------------------------------------
type AttRow = { period: string; attended: number; new_patients: number; repeat_patients: number; walk_in: number; by_appointment: number; completed: number; cancelled: number; no_show: number };
type Att = { rows: AttRow[]; totals: Omit<AttRow, "period"> };

function Attendance({ from, to }: R) {
  const [group, setGroup] = useState<"day" | "month">("day");
  const q = useReport<Att>("report_opd_attendance", { _from: from, _to: to, _group: group });
  return (
    <>
      <div className="no-print flex items-center gap-2">
        <span className="text-sm">Group by</span>
        <Select value={group} onValueChange={(v) => setGroup(v as "day" | "month")}>
          <SelectTrigger className="w-36" aria-label="Group by"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="day">Day</SelectItem><SelectItem value="month">Month</SelectItem></SelectContent>
        </Select>
      </div>
      <State q={q}>{() => {
        const d = q.data!;
        const t = d.totals;
        return (
          <>
            <StatGrid items={[
              { label: "OPD attendance", value: n(t.attended) },
              { label: "First visits", value: n(t.new_patients) },
              { label: "Repeat visits", value: n(t.repeat_patients) },
              { label: "Completed", value: n(t.completed) },
              { label: "No show / cancelled", value: n(t.no_show) + n(t.cancelled) },
            ]} />
            <ReportTable title={group === "day" ? "Daily attendance" : "Monthly attendance"} csvName={`opd_attendance_${group}_${from}_${to}`} rows={d.rows}
              columns={[
                { key: "period", label: group === "day" ? "Date" : "Month", format: (v) => (group === "month" ? String(v).slice(0, 7) : String(v)) },
                { key: "attended", label: "Attended", align: "right" },
                { key: "new_patients", label: "First visit", align: "right" },
                { key: "repeat_patients", label: "Repeat", align: "right" },
                { key: "walk_in", label: "Walk-in", align: "right" },
                { key: "by_appointment", label: "Appointment", align: "right" },
                { key: "completed", label: "Completed", align: "right" },
                { key: "cancelled", label: "Cancelled", align: "right" },
                { key: "no_show", label: "No show", align: "right" },
              ]} />
          </>
        );
      }}</State>
    </>
  );
}

// 3 ---------------------------------------------------------------------------
type SvcRow = { key: string; name: string; visits: number; completed: number; unique_patients: number; lab_requests: number; lab_tests: number };

function Services({ from, to }: R) {
  const q = useReport<{ rows: SvcRow[] }>("report_service_utilization", { _from: from, _to: to });
  return (
    <State q={q}>{() => {
      const rows = q.data!.rows;
      const total = rows.reduce((s, r) => s + n(r.visits), 0);
      return (
        <>
          <BarList title="Visits by clinical service" items={rows.map((r) => ({ label: r.name, value: n(r.visits) }))} />
          <ReportTable title="Clinical services utilisation" csvName={`services_${from}_${to}`} rows={rows}
            columns={[
              { key: "name", label: "Service" },
              { key: "visits", label: "Visits", align: "right" },
              { key: "key", label: "Share", align: "right", format: (_v, r) => pct(n(r.visits), total) },
              { key: "unique_patients", label: "Patients", align: "right" },
              { key: "completed", label: "Completed", align: "right" },
              { key: "lab_requests", label: "Lab requests", align: "right" },
              { key: "lab_tests", label: "Lab tests", align: "right" },
            ]} />
        </>
      );
    }}</State>
  );
}

// 4 ---------------------------------------------------------------------------
type VolRow = { section: string; name?: string; code?: string; ordered: number; verified: number; cancelled: number; pending: number; abnormal: number };

function LabVolume({ from, to }: R) {
  const q = useReport<{ requests: number; by_section: VolRow[]; by_test: VolRow[] }>("report_lab_volume", { _from: from, _to: to });
  return (
    <State q={q}>{() => {
      const d = q.data!;
      const ordered = d.by_section.reduce((s, r) => s + n(r.ordered), 0);
      const verified = d.by_section.reduce((s, r) => s + n(r.verified), 0);
      const cols = (withTest: boolean) => [
        { key: "section" as const, label: "Category" },
        ...(withTest ? [{ key: "name" as const, label: "Test" }] : []),
        { key: "ordered" as const, label: "Ordered", align: "right" as const },
        { key: "verified" as const, label: "Verified", align: "right" as const },
        { key: "pending" as const, label: "Pending", align: "right" as const },
        { key: "cancelled" as const, label: "Cancelled", align: "right" as const },
        { key: "abnormal" as const, label: "Flagged abnormal", align: "right" as const },
      ];
      return (
        <>
          <StatGrid items={[
            { label: "Lab requests", value: n(d.requests) },
            { label: "Tests ordered", value: ordered },
            { label: "Tests verified", value: verified },
            { label: "Completion rate", value: pct(verified, ordered) },
            { label: "Categories used", value: d.by_section.length },
          ]} />
          <ReportTable title="By category" csvName={`lab_volume_by_category_${from}_${to}`} rows={d.by_section} columns={cols(false)} />
          <ReportTable title="By individual test" csvName={`lab_volume_by_test_${from}_${to}`} rows={d.by_test} columns={cols(true)} />
          <p className="text-xs text-muted-foreground">"Flagged abnormal" counts only results whose abnormal mark was set from a configured reference range or answer list.</p>
        </>
      );
    }}</State>
  );
}

// 5 ---------------------------------------------------------------------------
type PendRow = { request_number: string; mrn: string; test: string; section: string; status: string; priority: string; requested_at: string; hours_waiting: number };
type Tat = {
  overall: { verified: number; median_minutes: number | null; avg_minutes: number | null; median_collected_minutes: number | null; urgent_median_minutes: number | null };
  by_test: { section: string; name: string; verified: number; median_minutes: number; avg_minutes: number; max_minutes: number }[];
  pending_by_status: { status: string; count: number }[];
  pending_total: number;
  pending: PendRow[];
};

function LabTurnaround({ from, to }: R) {
  const [offset, setOffset] = useState(0);
  const q = useReport<Tat>("report_lab_turnaround", { _from: from, _to: to, _limit: PAGE, _offset: offset });
  return (
    <State q={q}>{() => {
      const d = q.data!;
      const o = d.overall;
      return (
        <>
          <StatGrid items={[
            { label: "Tests verified (period)", value: n(o.verified) },
            { label: "Median request → verified", value: fmtMinutes(o.median_minutes) },
            { label: "Average request → verified", value: fmtMinutes(o.avg_minutes) },
            { label: "Median urgent", value: fmtMinutes(o.urgent_median_minutes) },
            { label: "Tests pending now", value: n(d.pending_total), tone: n(d.pending_total) ? "warn" : undefined },
          ]} />
          <ReportTable title="Turnaround by test (request to verification)" csvName={`lab_turnaround_${from}_${to}`} rows={d.by_test}
            columns={[
              { key: "section", label: "Category" }, { key: "name", label: "Test" },
              { key: "verified", label: "Verified", align: "right" },
              { key: "median_minutes", label: "Median", align: "right", format: (v) => fmtMinutes(v as number) },
              { key: "avg_minutes", label: "Average", align: "right", format: (v) => fmtMinutes(v as number) },
              { key: "max_minutes", label: "Longest", align: "right", format: (v) => fmtMinutes(v as number) },
            ]} />
          <BarList title="Pending tests by stage (all dates)" items={d.pending_by_status.map((p) => ({ label: LAB_STATUS_LABEL[p.status] ?? p.status, value: n(p.count) }))} />
          <ReportTable title="Pending tests — oldest and urgent first (all dates)" csvName="lab_pending" rows={d.pending}
            empty="No pending laboratory tests."
            columns={[
              { key: "request_number", label: "Request" }, { key: "mrn", label: "Patient no." },
              { key: "test", label: "Test" }, { key: "status", label: "Stage", format: (v) => LAB_STATUS_LABEL[v as string] ?? String(v) },
              { key: "priority", label: "Priority", format: (v) => (v === "urgent" ? "URGENT" : "Routine") },
              { key: "requested_at", label: "Requested", format: (v) => fmtDateTime(v as string) },
              { key: "hours_waiting", label: "Waiting (h)", align: "right" },
            ]}
            footer={<Pager offset={offset} limit={PAGE} total={n(d.pending_total)} onChange={setOffset} />} />
        </>
      );
    }}</State>
  );
}

// 6 ---------------------------------------------------------------------------
type Appt = {
  appointments_by_status: { status: string; count: number }[];
  appointments_by_day: { day: string; booked: number; attended: number; no_show: number; cancelled: number; still_scheduled: number }[];
  visits_by_status: { status: string; count: number }[];
  wait: { measured: number; median_wait_minutes: number | null; avg_wait_minutes: number | null };
  visit_length: { measured: number; median_minutes: number | null };
  checkins_by_hour: { hour: number; count: number }[];
};

function Appointments({ from, to }: R) {
  const q = useReport<Appt>("report_appointments_queue", { _from: from, _to: to });
  return (
    <State q={q}>{() => {
      const d = q.data!;
      const booked = d.appointments_by_status.reduce((s, a) => s + n(a.count), 0);
      const noShow = d.appointments_by_status.find((a) => a.status === "no_show")?.count ?? 0;
      return (
        <>
          <StatGrid items={[
            { label: "Appointments booked", value: booked },
            { label: "No-show rate", value: pct(n(noShow), booked) },
            { label: "Median wait (check-in → seen)", value: fmtMinutes(d.wait.median_wait_minutes) },
            { label: "Average wait", value: fmtMinutes(d.wait.avg_wait_minutes) },
            { label: "Median visit length", value: fmtMinutes(d.visit_length.median_minutes) },
          ]} />
          <div className="grid gap-4 lg:grid-cols-2">
            <BarList title="Appointments by status" items={d.appointments_by_status.map((a) => ({ label: APPT_STATUS_LABEL[a.status] ?? a.status, value: n(a.count) }))} />
            <BarList title="Queue entries by status" items={d.visits_by_status.map((a) => ({ label: VISIT_STATUS_LABEL[a.status] ?? a.status, value: n(a.count) }))} />
          </div>
          <BarList title="Check-ins by hour of day (clinic time)" items={d.checkins_by_hour.map((h) => ({ label: `${String(h.hour).padStart(2, "0")}:00`, value: n(h.count) }))} />
          <ReportTable title="Appointments per day" csvName={`appointments_${from}_${to}`} rows={d.appointments_by_day}
            columns={[
              { key: "day", label: "Date" }, { key: "booked", label: "Booked", align: "right" },
              { key: "attended", label: "Attended", align: "right" }, { key: "no_show", label: "No show", align: "right" },
              { key: "cancelled", label: "Cancelled", align: "right" }, { key: "still_scheduled", label: "Still scheduled", align: "right" },
            ]} />
          <p className="text-xs text-muted-foreground">Waiting time is measured for {d.wait.measured} visit(s) that were started by a clinician.</p>
        </>
      );
    }}</State>
  );
}

// 7 ---------------------------------------------------------------------------
type StaffRow = { id: string; full_name: string; active: boolean; roles: string | null; total_changes: number; patients_registered: number; visits_checked_in: number; notes_signed: number; lab_orders: number; results_entered: number; results_verified: number; amendments: number; permission_changes: number };

function StaffActivity({ from, to }: R) {
  const q = useReport<{ rows: StaffRow[] }>("report_staff_activity", { _from: from, _to: to });
  const navigate = useNavigate();
  return (
    <State q={q}>{() => (
      <>
        <ReportTable title="Activity per staff member" csvName={`staff_activity_${from}_${to}`} rows={q.data!.rows}
          columns={[
            { key: "full_name", label: "Staff" },
            { key: "roles", label: "Roles", format: (v) => String(v ?? "").split(",").filter(Boolean).map((r) => ROLE_LABELS[r as AppRole] ?? r).join(", ") || "—" },
            { key: "active", label: "Account", format: (v) => (v ? "Active" : "Disabled") },
            { key: "patients_registered", label: "Registered", align: "right" },
            { key: "visits_checked_in", label: "Checked in", align: "right" },
            { key: "notes_signed", label: "Notes signed", align: "right" },
            { key: "lab_orders", label: "Lab orders", align: "right" },
            { key: "results_entered", label: "Results entered", align: "right" },
            { key: "results_verified", label: "Verified", align: "right" },
            { key: "amendments", label: "Corrections", align: "right" },
            { key: "permission_changes", label: "Account changes", align: "right" },
            { key: "total_changes", label: "All recorded changes", align: "right", format: (v) => num(v) },
          ]} />
        <Button variant="outline" className="no-print" onClick={() => navigate({ to: "/admin/audit", search: { from, to } })}>Open the detailed audit log for this period</Button>
      </>
    )}</State>
  );
}

// Billing --------------------------------------------------------------------
type Bill = {
  currency: string; enabled: boolean;
  by_day: { day: string; invoices_issued: number; billed: number; collected: number; reversed: number; discounts: number }[];
  by_method: { method: string; amount: number; count: number }[];
  outstanding_total: number; outstanding_count: number;
};

function Billing({ from, to }: R) {
  const q = useReport<Bill>("report_billing", { _from: from, _to: to });
  return (
    <State q={q}>{() => {
      const d = q.data!;
      const c = d.currency;
      const sum = (k: "billed" | "collected" | "reversed" | "discounts") => d.by_day.reduce((s, r) => s + n(r[k]), 0);
      return (
        <>
          {!d.enabled && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">Billing is switched off (not configured). Figures below are empty until the clinic approves its prices and the administrator switches billing on.</div>}
          <StatGrid items={[
            { label: "Billed", value: money(sum("billed"), c) },
            { label: "Collected", value: money(sum("collected"), c) },
            { label: "Reversed payments", value: money(sum("reversed"), c) },
            { label: "Discounts", value: money(sum("discounts"), c) },
            { label: `Outstanding now (${n(d.outstanding_count)} invoices)`, value: money(d.outstanding_total, c), tone: n(d.outstanding_total) > 0 ? "warn" : undefined },
          ]} />
          <ReportTable title="Payments by method" csvName={`payments_by_method_${from}_${to}`} rows={d.by_method}
            columns={[
              { key: "method", label: "Method", format: (v) => PAYMENT_METHOD_LABEL[v as string] ?? String(v) },
              { key: "count", label: "Payments", align: "right" },
              { key: "amount", label: "Amount", align: "right", format: (v) => money(v as number, c) },
            ]} />
          <ReportTable title="Daily financial summary" csvName={`billing_daily_${from}_${to}`} rows={d.by_day.filter((r) => n(r.invoices_issued) || n(r.collected) || n(r.reversed) || n(r.discounts))}
            columns={[
              { key: "day", label: "Date" },
              { key: "invoices_issued", label: "Invoices issued", align: "right" },
              { key: "billed", label: "Billed", align: "right", format: (v) => money(v as number, c) },
              { key: "discounts", label: "Discounts", align: "right", format: (v) => money(v as number, c) },
              { key: "collected", label: "Collected", align: "right", format: (v) => money(v as number, c) },
              { key: "reversed", label: "Reversed", align: "right", format: (v) => money(v as number, c) },
              { key: "day", label: "Net collected", align: "right", format: (_v, r) => money(n(r.collected) - n(r.reversed), c) },
            ]} />
        </>
      );
    }}</State>
  );
}
