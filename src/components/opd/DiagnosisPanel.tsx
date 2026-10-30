import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useDiagnosisCatalog } from "@/lib/data";
import { dxQuery } from "@/lib/opd-queries";
import { F } from "./Field";

export function DiagnosisPanel({ visitId, patientId, editable }: { visitId: string; patientId: string; editable: boolean }) {
  const { data: dx } = useQuery(dxQuery(visitId));
  const { data: catalog } = useDiagnosisCatalog();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ id: string | null; name: string; code: string | null } | null>(null);
  const [type, setType] = useState<"primary" | "secondary">("primary");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || picked) return [];
    return (catalog ?? []).filter((c) => c.active && (c.name.toLowerCase().includes(s) || (c.icd10_code ?? "").toLowerCase().startsWith(s))).slice(0, 8);
  }, [q, catalog, picked]);

  async function add() {
    const name = picked?.name ?? q.trim();
    if (!name) { toast.error("Choose or type a diagnosis"); return; }
    setBusy(true);
    const { error } = await supabase.from("diagnoses").insert({
      visit_id: visitId, patient_id: patientId, description: name.slice(0, 200),
      icd10_code: picked?.code ?? null, catalog_id: picked?.id ?? null, diagnosis_type: type,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setQ(""); setPicked(null); setType("secondary");
    qc.invalidateQueries({ queryKey: ["dx", visitId] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("diagnoses").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["dx", visitId] });
  }

  return (
    <div className="space-y-3">
      {dx?.length === 0 && <p className="text-sm text-muted-foreground">No diagnosis recorded.</p>}
      {dx?.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
          <div>
            <span className="mr-2 rounded bg-secondary px-1.5 text-xs capitalize">{d.diagnosis_type}</span>
            {d.description} {d.icd10_code && <span className="font-mono text-xs text-muted-foreground">({d.icd10_code})</span>}
            {!d.catalog_id && <span className="ml-2 text-xs text-muted-foreground">· written by clinician</span>}
          </div>
          {editable && <Button size="icon" variant="ghost" aria-label={`Remove ${d.description}`} onClick={() => remove(d.id)}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      ))}
      {editable && (
        <div className="grid gap-2 md:grid-cols-[1fr_150px_auto] md:items-end">
          <div className="relative">
            <F label="Diagnosis (search the catalogue or type)">
              <Input
                value={picked ? `${picked.name}${picked.code ? ` (${picked.code})` : ""}` : q}
                onChange={(e) => { setPicked(null); setQ(e.target.value); }}
                maxLength={200}
                placeholder="e.g. malaria or B54"
                aria-label="Diagnosis search"
              />
            </F>
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md" role="listbox">
                {matches.map((m) => (
                  <button key={m.id} type="button" role="option" aria-selected={false}
                    className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => setPicked({ id: m.id, name: m.name, code: m.icd10_code })}>
                    <span>{m.name}</span><span className="font-mono text-xs text-muted-foreground">{m.icd10_code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <F label="Type">
            <Select value={type} onValueChange={(t) => setType(t as "primary")}>
              <SelectTrigger aria-label="Diagnosis type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="primary">Primary</SelectItem><SelectItem value="secondary">Secondary</SelectItem></SelectContent>
            </Select>
          </F>
          <Button onClick={add} disabled={busy}>Add diagnosis</Button>
        </div>
      )}
    </div>
  );
}
