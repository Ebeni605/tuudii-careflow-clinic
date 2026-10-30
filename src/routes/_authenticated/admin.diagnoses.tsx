import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { requireArea } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useDiagnosisCatalog } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/admin/diagnoses")({
  beforeLoad: requireArea("admin"),
  head: () => ({ meta: [{ title: "Diagnosis Catalogue — Two D Medium Clinic" }, { name: "description", content: "Manage the list of diagnoses clinicians choose from." }] }),
  component: () => <RequireArea area="admin"><Diagnoses /></RequireArea>,
});

function Diagnoses() {
  const { data, isLoading, error, refetch } = useDiagnosisCatalog();
  const qc = useQueryClient();
  const [n, setN] = useState({ name: "", icd10_code: "", category: "" });
  const [q, setQ] = useState("");

  async function patch(id: string, p: Record<string, unknown>) {
    const { error } = await supabase.from("diagnosis_catalog").update(p as never).eq("id", id);
    if (error) { toast.error(error.message.includes("diagnosis_catalog_name_unique") ? "That diagnosis is already in the list." : error.message); return; }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["diagnosis_catalog"] });
  }
  async function add() {
    if (!n.name.trim()) { toast.error("Enter the diagnosis name"); return; }
    const { error } = await supabase.from("diagnosis_catalog").insert({
      name: n.name.trim().slice(0, 200), icd10_code: n.icd10_code.trim().toUpperCase() || null, category: n.category.trim() || null,
      display_order: (data?.length ?? 0) + 100,
    });
    if (error) { toast.error(error.message.includes("diagnosis_catalog_name_unique") ? "That diagnosis is already in the list." : error.message); return; }
    toast.success("Diagnosis added");
    setN({ name: "", icd10_code: "", category: "" });
    qc.invalidateQueries({ queryKey: ["diagnosis_catalog"] });
  }

  const rows = (data ?? []).filter((d) => !q.trim() || `${d.name} ${d.icd10_code ?? ""} ${d.category ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <PageHeader title="Diagnosis catalogue" subtitle="Clinicians pick diagnoses from this list (they can also type one that is not listed). Turn off entries you no longer want offered; past records keep them." />
      <Card className="mb-4">
        <CardContent className="grid gap-2 p-3 md:grid-cols-[1fr_140px_200px_auto]">
          <Input placeholder="Diagnosis name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} maxLength={200} aria-label="New diagnosis name" />
          <Input placeholder="ICD-10 code" value={n.icd10_code} onChange={(e) => setN({ ...n, icd10_code: e.target.value })} maxLength={10} aria-label="ICD-10 code" />
          <Input placeholder="Category" value={n.category} onChange={(e) => setN({ ...n, category: e.target.value })} maxLength={60} aria-label="Category" />
          <Button onClick={add}>Add diagnosis</Button>
        </CardContent>
      </Card>
      <Input className="mb-3 max-w-sm" placeholder="Search the list" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search diagnoses" />
      {isLoading ? <PageLoading /> : error ? <LoadError onRetry={() => refetch()} /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Diagnosis</TableHead><TableHead>ICD-10</TableHead><TableHead>Category</TableHead><TableHead>Offered</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No diagnoses match.</TableCell></TableRow>}
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell><Input className="h-8" defaultValue={d.name} onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && patch(d.id, { name: e.target.value.trim() })} /></TableCell>
                  <TableCell><Input className="h-8 w-24 font-mono" defaultValue={d.icd10_code ?? ""} onBlur={(e) => e.target.value !== (d.icd10_code ?? "") && patch(d.id, { icd10_code: e.target.value.trim().toUpperCase() || null })} /></TableCell>
                  <TableCell><Input className="h-8 w-40" defaultValue={d.category ?? ""} onBlur={(e) => e.target.value !== (d.category ?? "") && patch(d.id, { category: e.target.value.trim() || null })} /></TableCell>
                  <TableCell><Switch checked={d.active} onCheckedChange={(active) => patch(d.id, { active })} aria-label={`Offer ${d.name}`} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
