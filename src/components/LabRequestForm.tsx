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
  ["Serology", "Urine Analysis", "Microscopy"],
];

export function LabRequestForm({ visitId, patientId, onDone }: { visitId: string; patientId: string; onDone?: () => void }) {
  const { data: tests } = useLabTests();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const active = (tests ?? []).filter((t) => t.active);

  function toggle(id: string) {
    const n = new Set(picked);
    n.has(id) ? n.delete(id) : n.add(id);
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
    if (!picked.size) return toast.error("Tick at least one test");
    setBusy(true);
    const { data: req, error } = await supabase.from("lab_requests")
      .insert({ visit_id: visitId, patient_id: patientId, priority: urgent ? "urgent" : "routine", clinical_notes: notes || null })
      .select("id, request_number").single();
    if (error) { setBusy(false); return toast.error(error.message); }
    const { error: e2 } = await supabase.from("lab_request_items").insert([...picked].map((id) => ({ lab_request_id: req.id, lab_test_id: id })));
    if (!e2) await supabase.from("visits").update({ status: "awaiting_lab" }).eq("id", visitId);
    setBusy(false);
    if (e2) return toast.error(e2.message);
    toast.success(`Lab request ${req.request_number} sent to laboratory`);
    setPicked(new Set()); setNotes(""); setUrgent(false);
    qc.invalidateQueries();
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
                      <button key={p} type="button" onClick={() => togglePanel(p)} className="mb-1 mr-1 rounded border border-primary/40 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10">+ Full {p}</button>
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
        <div className="space-y-1.5"><Label>Clinical notes for the laboratory</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></div>
        <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={urgent} onCheckedChange={setUrgent} /> Urgent</label>
      </div>
      <Button onClick={submit} disabled={busy}>{busy ? "Sending…" : `Send ${picked.size || ""} test(s) to laboratory`}</Button>
    </div>
  );
}
