import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import type { InvoiceState } from "@/lib/billing";

export function BillingOff({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="space-y-2 p-5 text-sm">
        <p className="font-semibold text-destructive">Billing is switched off (not configured).</p>
        <p>The clinic has not yet approved a price list. No invoices or payments can be recorded until an administrator enters the approved prices and switches billing on.</p>
        {isAdmin ? <Link to="/admin/billing" className="font-medium text-primary hover:underline">Open billing setup →</Link>
          : <p className="text-muted-foreground">Ask the administrator if the clinic wants to use billing.</p>}
      </CardContent>
    </Card>
  );
}

export const STATE_VARIANT: Record<InvoiceState, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", unpaid: "destructive", partly_paid: "secondary", paid: "default", void: "outline",
};

