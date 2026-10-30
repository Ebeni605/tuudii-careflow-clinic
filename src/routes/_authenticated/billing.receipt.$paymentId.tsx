import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadError, PageLoading, RequireArea } from "@/components/AppShell";
import { PrintHeader } from "@/components/ClinicBrand";
import { supabase } from "@/integrations/supabase/client";
import { requireArea } from "@/lib/auth";
import { patientName } from "@/lib/data";
import { fmtDateTime } from "@/lib/opd-queries";
import { money, PAYMENT_METHOD_LABEL } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/billing/receipt/$paymentId")({
  beforeLoad: requireArea("billing"),
  head: () => ({ meta: [{ title: "Receipt — Two D Medium Clinic" }, { name: "description", content: "Printable payment receipt." }] }),
  component: () => <RequireArea area="billing"><ReceiptPage /></RequireArea>,
});

function ReceiptPage() {
  const { paymentId } = Route.useParams();
  const q = useQuery({
    queryKey: ["receipt", paymentId],
    queryFn: async () => {
      const { data: p, error } = await supabase.from("payments")
        .select("*, invoices(id, invoice_number, currency, patients(mrn, first_name, middle_name, last_name))").eq("id", paymentId).maybeSingle();
      if (error) throw error;
      if (!p) return null;
      const [{ data: bal }, { data: staff }, { data: rev }] = await Promise.all([
        supabase.from("invoice_balances").select("*").eq("invoice_id", p.invoice_id).maybeSingle(),
        p.received_by ? supabase.from("profiles").select("full_name").eq("id", p.received_by).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("billing_adjustments").select("created_at, reason").eq("payment_id", paymentId).eq("kind", "payment_reversal").maybeSingle(),
      ]);
      return { p, bal, staff: staff?.full_name ?? "Staff", reversal: rev };
    },
  });
  if (q.isLoading) return <PageLoading />;
  if (q.error) return <LoadError message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="p-6 text-sm">Receipt not found.</div>;
  const { p, bal, staff, reversal } = q.data;
  const inv = p.invoices;
  const cur = inv?.currency ?? "ETB";
  return (
    <div className="mx-auto max-w-xl">
      <div className="no-print mb-3 flex items-center justify-between">
        {inv && <Link to="/billing/$invoiceId" params={{ invoiceId: inv.id }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" />Invoice {inv.invoice_number}</Link>}
        <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print receipt</Button>
      </div>
      <Card className="print-area">
        <CardContent className="space-y-4 p-6">
          <PrintHeader title="RECEIPT" />
          {reversal && <p className="rounded border border-destructive p-2 text-sm font-bold text-destructive">REVERSED on {fmtDateTime(reversal.created_at)} — {reversal.reason}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Receipt no.</dt><dd className="font-mono font-semibold">{p.receipt_number}</dd>
            <dt className="text-muted-foreground">Date</dt><dd>{fmtDateTime(p.received_at)}</dd>
            <dt className="text-muted-foreground">Patient</dt><dd className="font-semibold">{patientName(inv?.patients)}</dd>
            <dt className="text-muted-foreground">Patient no.</dt><dd className="font-mono">{inv?.patients?.mrn}</dd>
            <dt className="text-muted-foreground">Invoice</dt><dd className="font-mono">{inv?.invoice_number}</dd>
            <dt className="text-muted-foreground">Method</dt><dd>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</dd>
          </dl>
          <div className="flex items-center justify-between rounded-md bg-secondary p-4">
            <span className="font-semibold">Amount received</span>
            <span className="text-2xl font-bold tabular-nums text-primary">{money(p.amount, cur)}</span>
          </div>
          <div className="text-sm">Balance remaining on invoice: <b className="tabular-nums">{money(bal?.balance, cur)}</b></div>
          <div className="flex justify-between pt-8 text-sm">
            <div>Received by: {staff}</div>
            <div className="w-40 border-t border-foreground pt-1 text-center text-xs">Signature / stamp</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
