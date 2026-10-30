import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { requireArea } from "@/lib/auth";
import { useServices } from "@/lib/data";
import { friendlyDbError } from "@/lib/patient-schema";
import { fmtDateTime } from "@/lib/opd-queries";
import { CHARGE_CATEGORY_LABEL, money, priceProblem, useBillingSettings } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/admin/billing")({
  beforeLoad: requireArea("admin"),
  head: () => ({ meta: [{ title: "Billing Setup — Two D Medium Clinic" }, { name: "description", content: "Switch optional billing on or off and maintain the approved price list." }] }),
  component: () => <RequireArea area="admin"><BillingSetup /></RequireArea>,
});

function BillingSetup() {
  const qc = useQueryClient();
  const settings = useBillingSettings();
  const [form, setForm] = useState({ enabled: false, currency: "ETB", approval_note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings.data) setForm({ enabled: settings.data.enabled, currency: settings.data.currency, approval_note: settings.data.approval_note ?? "" });
  }, [settings.data]);

  if (settings.isLoading) return <PageLoading />;
  if (settings.error) return <LoadError message={(settings.error as Error).message} onRetry={() => settings.refetch()} />;

  const needsNote = form.enabled && form.approval_note.trim().length < 5;
  async function save() {
    if (needsNote) { toast.error("Record who approved the prices before switching billing on"); return; }
    if (!/^[A-Z]{3}$/.test(form.currency)) { toast.error("Currency must be a 3-letter code such as ETB"); return; }
    setBusy(true);
    const { error } = await supabase.from("billing_settings").update({ enabled: form.enabled, currency: form.currency, approval_note: form.approval_note.trim() || null }).eq("id", 1);
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success(form.enabled ? "Billing switched on" : "Billing settings saved");
    qc.invalidateQueries({ queryKey: ["billing_settings"] });
  }

  return (
    <div>
      <PageHeader title="Billing setup" subtitle="Billing is optional and stays off until the clinic approves its prices. No prices are pre-filled." />
      <Card>
        <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch id="ben" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <Label htmlFor="ben" className="font-semibold">{form.enabled ? "Billing is ON" : "Billing is OFF (not configured)"}</Label>
          </div>
          <div className="grid gap-3 md:grid-cols-[8rem_1fr]">
            <div className="space-y-1.5"><Label htmlFor="bcur">Currency</Label><Input id="bcur" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="bnote">Price approval record {form.enabled && "*"}</Label>
              <Textarea id="bnote" rows={2} maxLength={500} placeholder="e.g. Price list approved by the medical director on (date)" value={form.approval_note} onChange={(e) => setForm({ ...form, approval_note: e.target.value })} />
              {needsNote && <p className="text-xs text-destructive">Required before billing can be switched on.</p>}
            </div>
          </div>
          {settings.data?.updated_at && <p className="text-xs text-muted-foreground">Last changed {fmtDateTime(settings.data.updated_at)}</p>}
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </CardContent>
      </Card>
      <PriceList currency={settings.data?.currency ?? "ETB"} />
    </div>
  );
}

function PriceList({ currency }: { currency: string }) {
  const qc = useQueryClient();
  const { data: services } = useServices();
  const q = useQuery({
    queryKey: ["charges", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_charges").select("*").order("category").order("display_order").order("name");
      if (error) throw error;
      return data;
    },
  });
  const [n, setN] = useState({ name: "", category: "consultation", service_key: "none", price: "" });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const refresh = () => { qc.invalidateQueries({ queryKey: ["charges"] }); };

  async function add() {
    const p = priceProblem(Number(n.price));
    if (!n.name.trim() || n.price === "" || p) { toast.error(p ?? "Enter a name and price"); return; }
    const { error } = await supabase.from("service_charges").insert({ name: n.name.trim(), category: n.category, service_key: n.service_key === "none" ? null : n.service_key, price: Number(n.price) });
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    setN({ name: "", category: n.category, service_key: "none", price: "" });
    toast.success("Charge added"); refresh();
  }
  async function update(id: string, patch: { price?: number; active?: boolean }) {
    if (patch.price !== undefined) { const p = priceProblem(patch.price); if (p) { toast.error(p); return; } }
    const { error } = await supabase.from("service_charges").update(patch).eq("id", id);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    setEdits((e) => { const c = { ...e }; delete c[id]; return c; });
    toast.success("Saved"); refresh();
  }

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Approved price list</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-secondary/40 p-3">
          <div className="min-w-56 flex-1 space-y-1.5"><Label htmlFor="cn">Charge name</Label><Input id="cn" maxLength={120} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={n.category} onValueChange={(v) => setN({ ...n, category: v })}>
              <SelectTrigger className="w-40" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CHARGE_CATEGORY_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Clinical service (optional)</Label>
            <Select value={n.service_key} onValueChange={(v) => setN({ ...n, service_key: v })}>
              <SelectTrigger className="w-56" aria-label="Clinical service"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="cpr">Price ({currency})</Label><Input id="cpr" type="number" min="0" step="0.01" className="w-32" value={n.price} onChange={(e) => setN({ ...n, price: e.target.value })} /></div>
          <Button onClick={add}>Add charge</Button>
        </div>
        {q.isLoading && <PageLoading />}
        {q.error && <LoadError message={(q.error as Error).message} onRetry={() => q.refetch()} />}
        {q.data && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Charge</TableHead><TableHead>Category</TableHead><TableHead>Price</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
              <TableBody>
                {q.data.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No prices entered. Add the clinic's approved charges above.</TableCell></TableRow>}
                {q.data.map((c) => (
                  <TableRow key={c.id} className={c.active ? "" : "text-muted-foreground"}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{CHARGE_CATEGORY_LABEL[c.category] ?? c.category}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input type="number" min="0" step="0.01" className="h-8 w-28" aria-label={`Price for ${c.name}`} value={edits[c.id] ?? String(c.price)} onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })} />
                        {edits[c.id] !== undefined && Number(edits[c.id]) !== Number(c.price) && <Button size="sm" onClick={() => update(c.id, { price: Number(edits[c.id]) })}>Save</Button>}
                        <span className="text-xs text-muted-foreground">{money(c.price, currency)}</span>
                      </div>
                    </TableCell>
                    <TableCell><Switch checked={c.active} aria-label={`${c.name} active`} onCheckedChange={(v) => update(c.id, { active: v })} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Price changes apply to new invoice items only; issued invoices keep the price that was charged.</p>
      </CardContent>
    </Card>
  );
}
