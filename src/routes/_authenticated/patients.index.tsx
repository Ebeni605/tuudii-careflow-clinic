import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { patientName } from "@/lib/data";
import { ageFromDob, canAccess } from "@/lib/workflow";
import { useStaff, requireArea } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/patients/")({
  beforeLoad: requireArea("patients"),
  head: () => ({ meta: [{ title: "Patients — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="patients"><Patients /></RequireArea>,
});

function Patients() {
  const [q, setQ] = useState("");
  const { data: me } = useStaff();
  const term = q.trim().replace(/[%,()]/g, "");
  const { data, isLoading } = useQuery({
    queryKey: ["patients", term],
    queryFn: async () => {
      let query = supabase.from("patients").select("*").order("created_at", { ascending: false }).limit(50);
      if (term) {
        const parts = term.split(/\s+/);
        for (const p of parts) {
          query = query.or(`first_name.ilike.%${p}%,middle_name.ilike.%${p}%,last_name.ilike.%${p}%,mrn.ilike.%${p}%,phone.ilike.%${p}%`);
        }
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Search by name, patient ID or phone number"
        actions={me && canAccess(me.roles, "reception") ? <Button asChild><Link to="/patients/new"><UserPlus className="mr-1 h-4 w-4" />Register patient</Link></Button> : null}
      />
      <div className="relative mb-4 max-w-xl">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input autoFocus className="pl-9" placeholder="e.g. TDC-2026-000001, Chaltu, 0900…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient ID</TableHead><TableHead>Name</TableHead><TableHead>Sex</TableHead><TableHead>Age</TableHead><TableHead>Phone</TableHead><TableHead>Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>}
            {data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No patients found.</TableCell></TableRow>}
            {data?.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs"><Link className="text-primary hover:underline" to="/patients/$patientId" params={{ patientId: p.id }}>{p.mrn}</Link></TableCell>
                <TableCell className="font-medium">
                  <Link to="/patients/$patientId" params={{ patientId: p.id }} className="hover:underline">{patientName(p)}</Link>
                  {p.allergies && <span className="ml-2 rounded bg-destructive/10 px-1.5 text-xs text-destructive">Allergy</span>}
                </TableCell>
                <TableCell className="capitalize">{p.sex}</TableCell>
                <TableCell>{ageFromDob(p.date_of_birth) ?? "—"}</TableCell>
                <TableCell>{p.phone ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{[p.kebele && `Kebele ${p.kebele}`, p.woreda].filter(Boolean).join(", ") || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
