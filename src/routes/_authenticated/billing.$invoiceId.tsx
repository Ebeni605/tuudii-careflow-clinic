import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { PrintHeader } from "@/components/ClinicBrand";
import { ReasonDialog } from "@/components/lab/ReasonDialog";
import { supabase } from "@/integrations/supabase/client";
import { requireArea, useStaff } from "@/lib/auth";
import { patientName } from "@/lib/data";
import { fmtDateTime } from "@/lib/opd-queries";
import { friendlyDbError } from "@/lib/patient-schema";
import { CHARGE_CATEGORY_LABEL, INVOICE_STATE_LABEL, invoiceState, money, PAYMENT_METHOD_LABEL, paymentProblem, priceProblem, useBillingSettings } from "@/lib/billing";
import { BillingOff, STATE_VARIANT } from "@/components/billing/BillingOff";

export const Route = createFileRoute("/_authenticated/billing/$invoiceId")({
  beforeLoad: requireArea("billing"),
  head: () => ({ meta: [{ title: "Invoice — Two D Medium Clinic" }, { name: "description", content: "Invoice items, payments and receipts." }] }),
  component: () => <RequireArea area="billing"><InvoicePage /></RequireArea>,
});

const invoiceQuery = (id: string) => ({
  queryKey: ["invoice", id],
  queryFn: async () => {
    const [inv, items, pays, adj, bal] = await Promise.all([
      supabase.from("invoices").select("*, patients(mrn, first_name, middle_name, last_name, sex, phone), visits(queue_date, queue_number)").eq("id", id).maybeSingle(),
      supabase.from("invoice_items").select("*").eq("invoice_id", id).order("created_at"),
      supabase.from("payments").select("*").eq("invoice_id", id).order("received_at"),
      supabase.from("billing_adjustments").select("*").eq("invoice_id", id).order("created_at"),
      supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(),
    ]);
    for (const r of [inv, items, pays, adj, bal]) if (r.error) throw r.error;
    if (!inv.data) return null;
    const ids = [inv.data.created_by, inv.data.issued_by, inv.data.voided_by, ...(pays.data ?? []).map((p) => p.received_by), ...(adj.data ?? []).map((a) => a.created_by)].filter(Boolean) as string[];
    const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", [...new Set(ids)]) : { data: [] };
    return { invoice: inv.data, items: items.data ?? [], payments: pays.data ?? [], adjustments: adj.data ?? [], balance: bal.data, names: new Map((people ?? []).map((p) => [p.id, p.full_name])) };
  },
});

function InvoicePage() {
  const { invoiceId } = Route.useParams();
  const qc = useQueryClient();
  const { data: me } = useStaff();
  const isAdmin = !!me?.roles.includes("administrator");
  const settings = useBillingSettings();
  const q = useQuery(invoiceQuery(invoiceId));
  const [voidOpen, setVoidOpen] = useState(false);
  const [reverse, setReverse] = useState<string | null>(null);
  const [discountAmt, setDiscountAmt] = useState("");
  const [discountOpen, setDiscountOpen] = useState(false);

  if (q.isLoading || settings.isLoading) return <PageLoading />;
  if (q.error) return <LoadError message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="p-6 text-sm">Invoice not found. <Link to="/billing" className="text-primary hover:underline">Back to billing</Link></div>;

  const { invoice: inv, items, payments, adjustments, balance: b, names } = q.data;
  const cur = inv.currency;
  const enabled = !!settings.data?.enabled;
  const gross = Number(b?.total ?? 0);
  const discount = Number(b?.discount ?? 0);
  const total = gross - discount;
  const balance = Number(b?.balance ?? 0);
  const state = invoiceState(inv.status, total, balance);
  const reversed = new Set(adjustments.filter((a) => a.kind === "payment_reversal").map((a) => a.payment_id));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["invoice", invoiceId] }); qc.invalidateQueries({ queryKey: ["invoices"] }); };
  const fail = (m: string) => { toast.error(friendlyDbError(m)); return false; };
  const who = (id: string | null) => (id ? names.get(id) ?? "Staff" : "—");

  async function issue() {
    const { error } = await supabase.from("invoices").update({ status: "issued" }).eq("id", invoiceId);
    if (error) return fail(error.message);
    toast.success("Invoice issued"); refresh(); return true;
  }
  async function removeItem(id: string) {
    const { error } = await supabase.from("invoice_items").delete().eq("id", id);
    if (error) return fail(error.message);
    refresh(); return true;
  }

  return (
    <div>
      <div className="no-print">
        <Link to="/billing" className="mb-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" />Billing</Link>
        <PageHeader title={`Invoice ${inv.invoice_number}`} subtitle={`${patientName(inv.patients)} · ${inv.patients?.mrn ?? ""}`}
          actions={<>
            <Badge variant={STATE_VARIANT[state]} className="text-sm">{INVOICE_STATE_LABEL[state]}</Badge>
            {inv.status !== "draft" && <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print invoice</Button>}
          </>} />
        {!enabled && <div className="mb-4"><BillingOff isAdmin={isAdmin} /></div>}
      </div>

      <div className="print-area space-y-4">
        <div className="hidden print:block">
          <PrintHeader title="INVOICE" />
          <div className="mt-3 grid grid-cols-2 gap-1 text-sm">
            <div>Invoice no: <b>{inv.invoice_number}</b></div><div>Date: {fmtDateTime(inv.issued_at ?? inv.created_at)}</div>
            <div>Patient: <b>{patientName(inv.patients)}</b></div><div>Patient no: {inv.patients?.mrn}</div>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">Amount</TableHead>{inv.status === "draft" && <TableHead className="no-print" />}</TableRow></TableHeader>
              <TableBody>
                {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-sm text-muted-foreground">No items yet. Add charges from the price list.</TableCell></TableRow>}
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.description}{!it.charge_id && <span className="ml-2 text-xs text-muted-foreground">(custom)</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(it.unit_price, cur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(it.line_total, cur)}</TableCell>
                    {inv.status === "draft" && <TableCell className="no-print text-right"><Button size="icon" variant="ghost" aria-label={`Remove ${it.description}`} onClick={() => removeItem(it.id)} disabled={!enabled}><Trash2 className="h-4 w-4" /></Button></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <Row label="Subtotal" value={money(gross, cur)} />
              {discount > 0 && <Row label="Discount" value={`− ${money(discount, cur)}`} />}
              <Row label="Total" value={money(total, cur)} strong />
              {inv.status !== "draft" && <Row label="Paid" value={money(b?.paid, cur)} />}
              {inv.status === "issued" && <Row label="Balance due" value={money(balance, cur)} strong />}
            </div>
            {inv.status === "draft" && enabled && <AddItem invoiceId={invoiceId} isAdmin={isAdmin} onDone={refresh} />}
            {inv.status === "draft" && enabled && (
              <div className="no-print flex justify-end"><Button onClick={issue} disabled={!items.length}>Issue invoice</Button></div>
            )}
            {inv.status === "void" && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">Void on {fmtDateTime(inv.voided_at)} by {who(inv.voided_by)}. Reason: {inv.void_reason}</p>}
          </CardContent>
        </Card>

        {inv.status !== "draft" && (
          <Card>
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>When</TableHead><TableHead>Method</TableHead><TableHead>Received by</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="no-print" /></TableRow></TableHeader>
                <TableBody>
                  {payments.length === 0 && <TableRow><TableCell colSpan={6} className="py-4 text-center text-sm text-muted-foreground">No payments yet.</TableCell></TableRow>}
                  {payments.map((p) => (
                    <TableRow key={p.id} className={reversed.has(p.id) ? "text-muted-foreground line-through" : ""}>
                      <TableCell className="font-mono">{p.receipt_number}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(p.received_at)}</TableCell>
                      <TableCell>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</TableCell>
                      <TableCell>{who(p.received_by)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.amount, cur)}</TableCell>
                      <TableCell className="no-print space-x-1 whitespace-nowrap text-right">
                        <Button size="sm" variant="outline" asChild><Link to="/billing/receipt/$paymentId" params={{ paymentId: p.id }}>Receipt</Link></Button>
                        {isAdmin && enabled && !reversed.has(p.id) && inv.status === "issued" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setReverse(p.id)}>Reverse</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {inv.status === "issued" && enabled && balance > 0 && <TakePayment invoiceId={invoiceId} balance={balance} currency={cur} onDone={refresh} />}
            </CardContent>
          </Card>
        )}

        {adjustments.length > 0 && (
          <Card className="no-print">
            <CardHeader><CardTitle className="text-base">Adjustments (permanent record)</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {adjustments.map((a) => (
                <div key={a.id} className="border-b py-1 last:border-0">
                  <b>{a.kind === "discount" ? `Discount ${money(a.amount, cur)}` : a.kind === "payment_reversal" ? `Payment reversed ${money(a.amount, cur)}` : "Invoice voided"}</b>
                  {" "}· {fmtDateTime(a.created_at)} · {who(a.created_by)} — {a.reason}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isAdmin && enabled && inv.status !== "void" && (
          <Card className="no-print">
            <CardHeader><CardTitle className="text-base">Administrator actions</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              {inv.status === "issued" && balance > 0 && (
                <>
                  <div className="space-y-1.5"><Label htmlFor="disc">Discount amount</Label><Input id="disc" type="number" min="0" step="0.01" className="w-36" value={discountAmt} onChange={(e) => setDiscountAmt(e.target.value)} /></div>
                  <Button variant="outline" disabled={!!paymentProblem(Number(discountAmt), balance)} onClick={() => setDiscountOpen(true)}>Apply discount</Button>
                </>
              )}
              <Button variant="destructive" onClick={() => setVoidOpen(true)}>Void invoice</Button>
              <p className="w-full text-xs text-muted-foreground">Payments must be reversed before an invoice can be voided. Every action needs a reason and is kept in the audit log.</p>
            </CardContent>
          </Card>
        )}
        <p className="hidden text-xs print:block">Printed {new Date().toLocaleString()} · Issued by {who(inv.issued_by)}</p>
      </div>

      <ReasonDialog open={voidOpen} onOpenChange={setVoidOpen} title="Void this invoice?" description="The invoice stays on record marked void. This cannot be undone." confirmLabel="Void invoice" destructive
        onConfirm={async (reason) => {
          if (reason.length < 5) return fail("Give a reason of at least 5 characters");
          const { error } = await supabase.rpc("void_invoice", { _invoice_id: invoiceId, _reason: reason });
          if (error) return fail(error.message);
          toast.success("Invoice voided"); refresh(); return true;
        }} />
      <ReasonDialog open={!!reverse} onOpenChange={(o) => !o && setReverse(null)} title="Reverse this payment?" description="The payment stays on record and a reversal is added. Use this for refunds or mistakes." confirmLabel="Reverse payment" destructive
        onConfirm={async (reason) => {
          if (reason.length < 5) return fail("Give a reason of at least 5 characters");
          const { error } = await supabase.from("billing_adjustments").insert({ invoice_id: invoiceId, payment_id: reverse, kind: "payment_reversal", reason });
          if (error) return fail(error.message);
          toast.success("Payment reversed"); setReverse(null); refresh(); return true;
        }} />
      <ReasonDialog open={discountOpen} onOpenChange={setDiscountOpen} title={`Apply a discount of ${money(Number(discountAmt), cur)}?`} confirmLabel="Apply discount"
        onConfirm={async (reason) => {
          if (reason.length < 5) return fail("Give a reason of at least 5 characters");
          const { error } = await supabase.from("billing_adjustments").insert({ invoice_id: invoiceId, kind: "discount", amount: Number(discountAmt), reason });
          if (error) return fail(error.message);
          toast.success("Discount applied"); setDiscountAmt(""); refresh(); return true;
        }} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 ${strong ? "font-bold" : ""}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}

function AddItem({ invoiceId, isAdmin, onDone }: { invoiceId: string; isAdmin: boolean; onDone: () => void }) {
  const [charge, setCharge] = useState("");
  const [qty, setQty] = useState("1");
  const [custom, setCustom] = useState({ description: "", price: "" });
  const [busy, setBusy] = useState(false);
  const { data: charges } = useQuery({
    queryKey: ["charges", "active"],
    queryFn: async () => (await supabase.from("service_charges").select("id, name, category, price").eq("active", true).order("category").order("display_order").order("name")).data ?? [],
  });
  const quantity = Math.trunc(Number(qty));
  const qtyOk = quantity >= 1 && quantity <= 1000;

  async function add(row: { charge_id?: string; description: string; unit_price: number }) {
    setBusy(true);
    const { error } = await supabase.from("invoice_items").insert({ invoice_id: invoiceId, quantity, ...row });
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    setCharge(""); setQty("1"); setCustom({ description: "", price: "" }); onDone();
  }
  const sel = charges?.find((c) => c.id === charge);

  return (
    <div className="no-print space-y-3 rounded-md border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label>Charge from price list</Label>
          <Select value={charge} onValueChange={setCharge}>
            <SelectTrigger aria-label="Charge"><SelectValue placeholder={charges?.length ? "Choose a charge" : "Price list is empty"} /></SelectTrigger>
            <SelectContent>{charges?.map((c) => <SelectItem key={c.id} value={c.id}>{CHARGE_CATEGORY_LABEL[c.category]} · {c.name} — {money(c.price)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="qty">Qty</Label><Input id="qty" type="number" min="1" max="1000" className="w-20" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <Button disabled={!sel || !qtyOk || busy} onClick={() => sel && add({ charge_id: sel.id, description: sel.name, unit_price: Number(sel.price) })}>Add</Button>
      </div>
      {isAdmin && (
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <div className="min-w-64 flex-1 space-y-1.5"><Label htmlFor="cd">Custom item (administrator only)</Label><Input id="cd" maxLength={200} value={custom.description} onChange={(e) => setCustom({ ...custom, description: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="cp">Unit price</Label><Input id="cp" type="number" min="0" step="0.01" className="w-32" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} /></div>
          <Button variant="outline" disabled={!custom.description.trim() || custom.price === "" || !!priceProblem(Number(custom.price)) || !qtyOk || busy}
            onClick={() => add({ description: custom.description.trim(), unit_price: Number(custom.price) })}>Add custom</Button>
        </div>
      )}
    </div>
  );
}

function TakePayment({ invoiceId, balance, currency, onDone }: { invoiceId: string; balance: number; currency: string; onDone: () => void }) {
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = paymentProblem(Number(amount), balance);
  async function pay() {
    setBusy(true);
    const { data, error } = await supabase.from("payments").insert({ invoice_id: invoiceId, amount: Number(amount), method, reference: reference || null }).select("receipt_number").single();
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success(`Payment recorded · receipt ${data.receipt_number}`);
    setReference(""); onDone();
  }
  return (
    <div className="no-print flex flex-wrap items-end gap-3 rounded-md border bg-secondary/40 p-3">
      <div className="space-y-1.5"><Label htmlFor="pa">Amount ({currency})</Label><Input id="pa" type="number" min="0.01" step="0.01" className="w-36" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="space-y-1.5">
        <Label>Method</Label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-44" aria-label="Payment method"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-w-40 flex-1 space-y-1.5"><Label htmlFor="pr">Reference (optional)</Label><Input id="pr" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID" /></div>
      <Button onClick={pay} disabled={!!problem || busy}>{busy ? "Saving…" : "Record payment"}</Button>
      {problem && amount !== "" && <p className="w-full text-sm text-destructive">{problem}</p>}
    </div>
  );
}
