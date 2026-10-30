// Optional billing rules shared by the billing pages. The database triggers enforce the same rules.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
  card: "Card",
  other: "Other",
};

export const CHARGE_CATEGORY_LABEL: Record<string, string> = {
  consultation: "Consultation",
  laboratory: "Laboratory",
  procedure: "Procedure",
  other: "Other",
};

export function money(amount: number | string | null | undefined, currency = "ETB") {
  const n = Number(amount ?? 0);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type InvoiceState = "draft" | "unpaid" | "partly_paid" | "paid" | "void";

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  draft: "Draft",
  unpaid: "Unpaid",
  partly_paid: "Partly paid",
  paid: "Paid",
  void: "Void",
};

/** What staff see for an invoice, from its stored status and running balance. */
export function invoiceState(status: string, total: number, balance: number): InvoiceState {
  if (status === "void") return "void";
  if (status === "draft") return "draft";
  if (balance <= 0) return "paid";
  if (balance < total) return "partly_paid";
  return "unpaid";
}

/** Problem with a payment amount, or null. Mirrors DB trigger payment_before. */
export function paymentProblem(amount: number, balance: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than 0";
  if (Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return "Use at most 2 decimal places";
  if (amount > balance + 1e-9) return `Amount is more than the balance due (${balance.toFixed(2)})`;
  return null;
}

/** Problem with a price entered by the administrator, or null. Mirrors the price check on service_charges. */
export function priceProblem(price: number): string | null {
  if (!Number.isFinite(price) || price < 0) return "Enter a price of 0 or more";
  if (price > 10_000_000) return "Price is too large";
  return null;
}

export function useBillingSettings() {
  return useQuery({
    queryKey: ["billing_settings"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("billing_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data ?? { id: 1, enabled: false, currency: "ETB", approval_note: null, updated_by: null, updated_at: "" };
    },
  });
}
