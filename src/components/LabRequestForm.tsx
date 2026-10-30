import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useLabTests } from "@/lib/data";

// Column layout copied from the clinic's paper Laboratory Request form.
export const FORM_COLUMNS = [
  ["Hematology", "Bacteriology & Parasitology"],
  ["Serology", "Urine Analysis", "Microscopy Examination"],
];

/** Sends one laboratory order (several tests) for the visit; the database links it to the patient, visit and consultation. */
export function LabRequestForm({ visitId, onDone }: { visitId: string; onDone?: () => void }) {
  const { data: tests } = useLabTests();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const active = (tests ?? []).filter((t) => t.active);

  function toggle(id: string) {
    const n = new Set(picked);
    if (n.has(id)) n.delete(id); else n.add(id);
    setPicked(n);
  }
  function togglePanel(panel: string) {
    const ids = active.filter((t) => t.panel === panel).map((t) => t.id);
    const all = ids.every((i) => picked.has(i));
    const n = new Set(picked);
    ids.forEach((i) => (all ? n.delete(i) : n.add(i)));
    setPicked(n);
  }

  async function submit() {
    if (!picked.size) { toast.error("Tick at least one test"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_lab_order", {
      _visit_id: visitId, _test_ids: [...picked], _priority: urgent ? "urgent" : "routine", _notes: notes.trim(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const no = (data as { request_number?: string } | null)?.request_number ?? "";
    toast.success(`Lab order ${no} sent to the laboratory`);
    setPicked(new Set()); setNotes(""); setUrgent(false);
    qc.invalidateQueries({ queryKey: ["visit_labs", visitId] });
    qc.invalidateQueries({ queryKey: ["visit", visitId] });
    qc.invalidateQueries({ queryKey: ["opd_queue"] });
    onDone?.();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {FORM_COLUMNS.map((col, i) => (
          <div key={i} className="rounded-md border">
            {col.map((section) => {
              const items = active.filter((t) => t.section === section);
              const panels = [...new Set(items.map((t) => t.panel).filter(Boolean))] as string[];
              return (
                <div key={section} className="border-b last:border-b-0">
                  <div className="bg-secondary px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-secondary-foreground">{section}</div>
                  <div className="space-y-1 p-2">
                    {panels.map((p) => (
                      <button key={p} type="button" onClick={() => togglePanel(p)} className="mb-1 mr-1 rounded border border-primary/40 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10">☐ {p} (full panel)</button>
                    ))}
                    {items.map((t) => (
                      <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                        <Checkbox checked={picked.has(t.id)} onCheckedChange={() => toggle(t.id)} />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-1.5"><Label htmlFor="lab-indication">Clinical indication for the laboratory</Label><Textarea id="lab-indication" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></div>
        <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={urgent} onCheckedChange={setUrgent} /> Urgent</label>
      </div>
      <Button onClick={submit} disabled={busy}>{busy ? "Sending…" : `Send ${picked.size || ""} test(s) to laboratory`}</Button>
    </div>
  );
}
