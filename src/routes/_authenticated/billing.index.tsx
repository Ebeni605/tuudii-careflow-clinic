import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { PatientPicker, type PickedPatient } from "@/components/PatientPicker";
import { supabase } from "@/integrations/supabase/client";
import { requireArea, useStaff } from "@/lib/auth";
import { clinicDayRange, patientName, useServices } from "@/lib/data";
import { clinicToday, friendlyDbError } from "@/lib/patient-schema";
import { fmtDateTime } from "@/lib/opd-queries";
import { INVOICE_STATE_LABEL, invoiceState, money, useBillingSettings, type InvoiceState } from "@/lib/billing";
import { BillingOff, STATE_VARIANT } from "@/components/billing/BillingOff";

export const Route = createFileRoute("/_authenticated/billing/")({
  beforeLoad: requireArea("billing"),
  head: () => ({ meta: [{ title: "Billing — Two D Medium Clinic" }, { name: "description", content: "Invoices, payments and receipts (optional module)." }] }),
  component: () => <RequireArea area="billing"><Billing /></RequireArea>,
});

function Billing() {
  const { data: me } = useStaff();
  const isAdmin = !!me?.roles.includes("admin");
  const settings = useBillingSettings();
  const [day, setDay] = useState(clinicToday());
  const [filter, setFilter] = useState<"all" | InvoiceState>("all");

  const list = useQuery({
    queryKey: ["invoices", day],
    enabled: !!settings.data?.enabled,
    queryFn: async () => {
      const r = clinicDayRange(day);
      const { data, error } = await supabase.from("invoices")
        .select("id, invoice_number, status, currency, created_at, patients(mrn, first_name, middle_name, last_name)")
        .gte("created_at", r.from).lt("created_at", r.to).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const ids = (data ?? []).map((i) => i.id);
      const { data: bal } = ids.length ? await supabase.from("invoice_balances").select("*").in("invoice_id", ids) : { data: [] };
      const byId = new Map((bal ?? []).map((b) => [b.invoice_id, b]));
      return (data ?? []).map((i) => {
        const b = byId.get(i.id);
        const total = Number(b?.total ?? 0) - Number(b?.discount ?? 0);
        const balance = Number(b?.balance ?? 0);
        return { ...i, total, paid: Number(b?.paid ?? 0), balance, state: invoiceState(i.status, total, balance) };
      });
    },
  });

  if (settings.isLoading) return <PageLoading />;
  if (settings.error) return <LoadError message={(settings.error as Error).message} onRetry={() => settings.refetch()} />;
  if (!settings.data?.enabled) return <div><PageHeader title="Billing" /><BillingOff isAdmin={isAdmin} /></div>;

  const rows = (list.data ?? []).filter((r) => filter === "all" || r.state === filter);
  const cur = settings.data.currency;

  return (
    <div>
      <PageHeader title="Billing" subtitle="Prices come only from the administrator's approved price list. Payments are never edited or deleted." />
      <NewInvoice />
      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-end gap-3 space-y-0">
          <CardTitle className="mr-auto text-base">Invoices</CardTitle>
          <div className="space-y-1"><Label htmlFor="bd" className="text-xs">Day</Label><Input id="bd" type="date" value={day} onChange={(e) => setDay(e.target.value || clinicToday())} className="w-40" /></div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-40" aria-label="Invoice status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {(Object.keys(INVOICE_STATE_LABEL) as InvoiceState[]).map((k) => <SelectItem key={k} value={k}>{INVOICE_STATE_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {list.isLoading && <PageLoading />}
          {list.error && <div className="p-4"><LoadError message={(list.error as Error).message} onRetry={() => list.refetch()} /></div>}
          {list.data && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Patient</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No invoices for this day.</TableCell></TableRow>}
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><Link to="/billing/$invoiceId" params={{ invoiceId: r.id }} className="font-mono text-primary hover:underline">{r.invoice_number}</Link></TableCell>
                      <TableCell><div className="font-medium">{patientName(r.patients)}</div><div className="font-mono text-xs text-muted-foreground">{r.patients?.mrn}</div></TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(r.created_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.total, cur)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.state === "void" ? "—" : money(r.balance, cur)}</TableCell>
                      <TableCell><Badge variant={STATE_VARIANT[r.state]}>{INVOICE_STATE_LABEL[r.state]}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewInvoice() {
  const navigate = useNavigate();
  const { data: services } = useServices();
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [visitId, setVisitId] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const visits = useQuery({
    queryKey: ["bill_visits", patient?.id],
    enabled: !!patient,
    queryFn: async () => {
      const { data, error } = await supabase.from("visits").select("id, queue_date, queue_number, service_key, status")
        .eq("patient_id", patient!.id).order("checked_in_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
  });
  const svcName = (k: string) => services?.find((s) => s.key === k)?.name ?? k;

  async function create() {
    if (!patient) return;
    setBusy(true);
    const { data, error } = await supabase.from("invoices").insert({ patient_id: patient.id, visit_id: visitId === "none" ? null : visitId }).select("id").single();
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success("Draft invoice created");
    navigate({ to: "/billing/$invoiceId", params: { invoiceId: data.id } });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" />New invoice</CardTitle></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="space-y-1.5"><Label>Patient</Label><PatientPicker value={patient} onChange={(p) => { setPatient(p); setVisitId("none"); }} /></div>
        <div className="space-y-1.5">
          <Label>Link to visit (optional)</Label>
          <Select value={visitId} onValueChange={setVisitId} disabled={!patient}>
            <SelectTrigger aria-label="Visit"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No visit</SelectItem>
              {visits.data?.map((v) => <SelectItem key={v.id} value={v.id}>{v.queue_date} · #{v.queue_number ?? "—"} · {svcName(v.service_key)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={create} disabled={!patient || busy}><Plus className="mr-1 h-4 w-4" />{busy ? "Creating…" : "Create draft"}</Button>
      </CardContent>
    </Card>
  );
}
