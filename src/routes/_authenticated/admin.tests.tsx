import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { requireArea } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useLabTests } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/admin/tests")({
  beforeLoad: requireArea("admin"),
  head: () => ({ meta: [{ title: "Test Catalogue — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="admin"><Tests /></RequireArea>,
});

function Tests() {
  const { data } = useLabTests();
  const qc = useQueryClient();
  async function patch(id: string, p: Record<string, unknown>) {
    const { error } = await supabase.from("lab_tests").update(p as never).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["lab_tests"] });
  }
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div>
      <PageHeader title="Laboratory test catalogue" subtitle="Based on the clinic's paper request form. Edit units and reference ranges; changes save when you leave a field." />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Section</TableHead><TableHead>Test</TableHead><TableHead>Unit</TableHead><TableHead>Low</TableHead><TableHead>High</TableHead><TableHead>Normal text</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-xs text-muted-foreground">{t.section}</TableCell>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell><Input className="h-8 w-24" defaultValue={t.unit ?? ""} onBlur={(e) => e.target.value !== (t.unit ?? "") && patch(t.id, { unit: e.target.value || null })} /></TableCell>
                <TableCell><Input className="h-8 w-20" type="number" step="any" defaultValue={t.ref_low ?? ""} onBlur={(e) => num(e.target.value) !== t.ref_low && patch(t.id, { ref_low: num(e.target.value) })} /></TableCell>
                <TableCell><Input className="h-8 w-20" type="number" step="any" defaultValue={t.ref_high ?? ""} onBlur={(e) => num(e.target.value) !== t.ref_high && patch(t.id, { ref_high: num(e.target.value) })} /></TableCell>
                <TableCell><Input className="h-8 w-40" defaultValue={t.ref_text ?? ""} onBlur={(e) => e.target.value !== (t.ref_text ?? "") && patch(t.id, { ref_text: e.target.value || null })} /></TableCell>
                <TableCell><Switch checked={t.active} onCheckedChange={(active) => patch(t.id, { active })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
