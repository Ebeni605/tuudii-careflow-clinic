import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useStaffNames } from "@/lib/data";
import { amendmentsQuery, fmtDateTime } from "@/lib/opd-queries";
import { F } from "./Field";

const KIND_LABEL: Record<string, string> = { addendum: "Addendum", correction: "Correction", result_review: "Lab result review" };
const SECTIONS = ["Chief complaint", "History", "Examination", "Assessment", "Diagnosis", "Treatment plan", "Medication instructions", "Follow-up / referral", "Service form", "Other"];

/** Signed notes are never overwritten; changes are appended here with name and time. */
export function AmendmentsPanel({ consultationId, canAdd }: { consultationId: string; canAdd: boolean }) {
  const { data: rows } = useQuery(amendmentsQuery(consultationId));
  const { data: names } = useStaffNames();
  const qc = useQueryClient();
  const [kind, setKind] = useState("result_review");
  const [section, setSection] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!note.trim()) { toast.error("Write the amendment"); return; }
    if (kind === "correction" && !section) { toast.error("Choose the part of the note being corrected"); return; }
    setBusy(true);
    const { error } = await supabase.from("consultation_amendments").insert({
      consultation_id: consultationId, kind, section: section || null, note: note.trim(),
      visit_id: consultationId, patient_id: consultationId, // replaced by the database from the consultation
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Amendment added");
    setNote(""); setSection("");
    qc.invalidateQueries({ queryKey: ["amendments", consultationId] });
  }

  return (
    <div className="space-y-3">
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">No amendments.</p>}
      {rows?.map((a) => (
        <div key={a.id} className="rounded-md border-l-4 border-l-primary bg-card p-3 text-sm shadow-sm">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 font-semibold text-secondary-foreground">{KIND_LABEL[a.kind] ?? a.kind}</span>
            {a.section && <span>· {a.section}</span>}
            <span>· {names?.[a.created_by ?? ""] ?? "—"} · {fmtDateTime(a.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap">{a.note}</p>
        </div>
      ))}
      {canAdd && (
        <div className="grid gap-2 rounded-md border bg-secondary/30 p-3 md:grid-cols-[200px_220px_1fr]">
          <F label="Type">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label={kind === "correction" ? "Part corrected" : "Part (optional)"} required={kind === "correction"}>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{SECTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Note" className="md:col-span-3">
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={kind === "result_review" ? "Results reviewed and the decision you made…" : "What is added or corrected, and why…"} />
          </F>
          <div><Button onClick={add} disabled={busy}>{busy ? "Saving…" : "Add amendment"}</Button></div>
        </div>
      )}
    </div>
  );
}
