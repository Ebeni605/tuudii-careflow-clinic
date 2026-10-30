import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { Pager } from "@/components/reports/ReportKit";
import { requireArea } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { addDays, downloadCsv, rangeProblem, searchDate, toCsv } from "@/lib/reports";
import { clinicToday } from "@/lib/patient-schema";
import { fmtDateTime } from "@/lib/opd-queries";

type Search = { from?: string | undefined; to?: string | undefined };

export const Route = createFileRoute("/_authenticated/admin/audit")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    from: searchDate(s["from"]),
    to: searchDate(s["to"]),
  }),
  beforeLoad: requireArea("admin"),
  head: () => ({ meta: [{ title: "Audit Log — Two D Medium Clinic" }, { name: "description", content: "Who changed which record, and when." }] }),
  component: () => <RequireArea area="admin"><Audit /></RequireArea>,
});

const AREAS: Record<string, string> = {
  patients: "Patient records", visits: "Visits / queue", appointments: "Appointments",
  consultations: "Consultation notes", consultation_amendments: "Note amendments", diagnoses: "Diagnoses",
  medication_instructions: "Medication instructions", vital_signs: "Vital signs",
  lab_requests: "Lab requests", lab_request_items: "Lab tests (status / verification)", lab_results: "Lab results",
  lab_result_amendments: "Lab result corrections", lab_specimens: "Specimens", lab_specimen_tests: "Specimen links",
  lab_tests: "Test catalogue", diagnosis_catalog: "Diagnosis catalogue",
  profiles: "Staff profiles / permissions", user_roles: "Staff roles", staff_accounts: "Staff accounts & passwords",
  billing_settings: "Billing settings", service_charges: "Price list", invoices: "Invoices", invoice_items: "Invoice items",
  payments: "Payments", billing_adjustments: "Billing adjustments",
};
const ACTION_LABEL: Record<string, string> = {
  INSERT: "Created", UPDATE: "Changed", DELETE: "Removed",
  STAFF_CREATED: "Staff account created", PASSWORD_RESET_BY_ADMIN: "Password reset by admin", FIRST_ADMIN_CREATED: "First admin created",
};
const LIMIT = 50;

type Row = { id: number; changed_at: string; user_id: string | null; staff_name: string; table_name: string; action: string; record_id: string | null };

function Audit() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/audit" });
  const today = clinicToday();
  const from = search.from ?? addDays(today, -6);
  const to = search.to ?? today;
  const [area, setArea] = useState("all");
  const [staff, setStaff] = useState("all");
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<number | null>(null);
  const problem = rangeProblem(from, to);

  const { data: people } = useQuery({
    queryKey: ["audit_staff"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name").order("full_name")).data ?? [],
  });
  const args = { _from: from, _to: to, _user: staff === "all" ? null : staff, _table: area === "all" ? null : area, _action: null };
  const q = useQuery({
    queryKey: ["audit", args, offset],
    enabled: !problem,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_audit_events", { ...args, _limit: LIMIT, _offset: offset } as never);
      if (error) throw error;
      return data as unknown as { total: number; rows: Row[] };
    },
  });

  async function exportAll() {
    const all: Row[] = [];
    for (let o = 0; o < (q.data?.total ?? 0); o += 500) {
      const { data } = await supabase.rpc("report_audit_events", { ...args, _limit: 500, _offset: o } as never);
      all.push(...((data as unknown as { rows: Row[] })?.rows ?? []));
    }
    downloadCsv(`audit_${from}_${to}`, toCsv(all, [
      { key: "changed_at", label: "When", format: (v) => fmtDateTime(v as string) },
      { key: "staff_name", label: "Staff" },
      { key: "action", label: "Action", format: (v) => ACTION_LABEL[v as string] ?? String(v) },
      { key: "table_name", label: "Area", format: (v) => AREAS[v as string] ?? String(v) },
      { key: "record_id", label: "Record reference" },
    ]));
  }

  const setRange = (k: "from" | "to", v: string) => { setOffset(0); navigate({ search: (p) => ({ ...p, [k]: v }) }); };

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every change to clinical, laboratory, staff and billing records, with who made it and when. Entries cannot be edited or deleted." />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5"><Label htmlFor="af">From</Label><Input id="af" type="date" value={from} onChange={(e) => setRange("from", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="at">To</Label><Input id="at" type="date" value={to} onChange={(e) => setRange("to", e.target.value)} /></div>
          <div className="min-w-48 space-y-1.5">
            <Label>Staff member</Label>
            <Select value={staff} onValueChange={(v) => { setStaff(v); setOffset(0); }}>
              <SelectTrigger aria-label="Staff member"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                {people?.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || "Unnamed"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-56 space-y-1.5">
            <Label>Area</Label>
            <Select value={area} onValueChange={(v) => { setArea(v); setOffset(0); }}>
              <SelectTrigger aria-label="Area"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All areas</SelectItem>
                {Object.entries(AREAS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={!q.data?.total} onClick={exportAll}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
          {problem && <p className="w-full text-sm text-destructive">{problem}</p>}
        </CardContent>
      </Card>
      {q.isLoading && <PageLoading />}
      {q.error && <LoadError message={(q.error as Error).message} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Staff</TableHead><TableHead>Action</TableHead><TableHead>Area</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {q.data.rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No changes recorded for these filters.</TableCell></TableRow>}
                {q.data.rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(a.changed_at)}</TableCell>
                    <TableCell>{a.staff_name}</TableCell>
                    <TableCell>{ACTION_LABEL[a.action] ?? a.action}</TableCell>
                    <TableCell>{AREAS[a.table_name] ?? a.table_name.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setDetail(a.id)}>Details</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="border-t px-4 py-2"><Pager offset={offset} limit={LIMIT} total={q.data.total} onChange={setOffset} /></div>
        </Card>
      )}
      <AuditDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/** Shows which fields changed (old → new). Loaded only when an administrator opens it. */
function AuditDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["audit_detail", id],
    enabled: id != null,
    queryFn: async () => (await supabase.from("audit_log").select("*").eq("id", id!).maybeSingle()).data,
  });
  const diff = (data?.diff ?? null) as Record<string, unknown> | null;
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  if (diff && data?.action === "UPDATE" && diff["old"] && diff["new"]) {
    const o = diff["old"] as Record<string, unknown>, nw = diff["new"] as Record<string, unknown>;
    for (const k of Object.keys(nw)) if (JSON.stringify(o[k]) !== JSON.stringify(nw[k]) && k !== "updated_at") changes.push({ field: k, old: o[k], new: nw[k] });
  } else if (diff) {
    for (const [k, v] of Object.entries(diff)) if (v !== null && v !== "") changes.push({ field: k, old: undefined, new: v });
  }
  const show = (v: unknown) => (v === undefined ? "" : v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <Dialog open={id != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change details</DialogTitle>
          <DialogDescription>{data ? `${ACTION_LABEL[data.action] ?? data.action} · ${AREAS[data.table_name] ?? data.table_name} · ${fmtDateTime(data.changed_at)}` : ""}</DialogDescription>
        </DialogHeader>
        {isLoading && <PageLoading />}
        {!isLoading && changes.length === 0 && <p className="text-sm text-muted-foreground">No field details stored for this entry.</p>}
        {changes.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Field</TableHead>{data?.action === "UPDATE" && <TableHead>Before</TableHead>}<TableHead>{data?.action === "UPDATE" ? "After" : "Value"}</TableHead></TableRow></TableHeader>
            <TableBody>
              {changes.map((c) => (
                <TableRow key={c.field}>
                  <TableCell className="font-mono text-xs">{c.field}</TableCell>
                  {data?.action === "UPDATE" && <TableCell className="max-w-56 break-words text-xs">{show(c.old)}</TableCell>}
                  <TableCell className="max-w-56 break-words text-xs">{show(c.new)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
