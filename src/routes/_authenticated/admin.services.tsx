import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, RequireArea } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { requireArea } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/services")({
  beforeLoad: requireArea("admin"),
  head: () => ({ meta: [{ title: "Visit Services — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="admin"><Services /></RequireArea>,
});

function Services() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: ["services_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_categories").select("*").order("display_order");
      if (error) throw error;
      return data;
    },
  });
  async function patch(key: string, p: { name?: string; display_order?: number; active?: boolean }) {
    if (p.name !== undefined && !p.name.trim()) { toast.error("Name cannot be empty"); return; }
    const { error } = await supabase.from("service_categories").update(p).eq("key", key);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["services_all"] });
    qc.invalidateQueries({ queryKey: ["services"] });
  }
  return (
    <div className="max-w-3xl">
      <PageHeader title="Visit services" subtitle="Clinical service categories chosen at check-in. They are part of OPD, not separate departments. Changes save when you leave a field." />
      {error && <LoadError onRetry={() => refetch()} />}
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead className="w-20">Order</TableHead><TableHead>Name</TableHead><TableHead className="w-24">Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.map((s) => (
              <TableRow key={s.key}>
                <TableCell><Input className="h-8 w-16" type="number" defaultValue={s.display_order} onBlur={(e) => Number(e.target.value) !== s.display_order && patch(s.key, { display_order: Number(e.target.value) })} /></TableCell>
                <TableCell><Input className="h-8" defaultValue={s.name} maxLength={80} onBlur={(e) => e.target.value !== s.name && patch(s.key, { name: e.target.value.trim() })} /></TableCell>
                <TableCell><Switch checked={s.active} onCheckedChange={(active) => patch(s.key, { active })} aria-label={`${s.name} active`} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
