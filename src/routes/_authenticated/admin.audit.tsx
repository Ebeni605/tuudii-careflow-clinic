import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { requireArea } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useStaffNames } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  beforeLoad: requireArea("admin"),
  head: () => ({ meta: [{ title: "Audit Log — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="admin"><Audit /></RequireArea>,
});

function Audit() {
  const { data: names } = useStaffNames();
  const { data } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => (await supabase.from("audit_log").select("*").order("changed_at", { ascending: false }).limit(300)).data ?? [],
  });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="The latest 300 changes to clinical records" />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Staff</TableHead><TableHead>Action</TableHead><TableHead>Record type</TableHead><TableHead>Record</TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-sm">{new Date(a.changed_at).toLocaleString()}</TableCell>
                <TableCell>{a.user_id ? names?.[a.user_id] ?? "Unknown" : "System"}</TableCell>
                <TableCell>{a.action}</TableCell>
                <TableCell>{a.table_name.replace(/_/g, " ")}</TableCell>
                <TableCell className="font-mono text-xs">{a.record_id?.slice(0, 8)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
