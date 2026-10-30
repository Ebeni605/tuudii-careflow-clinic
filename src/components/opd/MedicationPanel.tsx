import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { medsQuery } from "@/lib/opd-queries";
import { F } from "./Field";

const ROUTES = ["Oral", "IV", "IM", "SC", "Topical", "Rectal", "Vaginal", "Inhaled", "Eye drops", "Ear drops", "Other"];
const EMPTY = { medicine: "", dose: "", route: "", frequency: "", duration: "", instructions: "" };

export function MedicationPanel({ visitId, patientId, consultationId, editable }: { visitId: string; patientId: string; consultationId: string; editable: boolean }) {
  const { data: meds } = useQuery(medsQuery(visitId));
  const qc = useQueryClient();
  const [m, setM] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, [k]: e.target.value });

  async function add() {
    if (!m.medicine.trim()) { toast.error("Enter the medicine name"); return; }
    setBusy(true);
    const row = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.trim() || null]));
    const { error } = await supabase.from("medication_instructions").insert({ ...row, medicine: m.medicine.trim(), visit_id: visitId, patient_id: patientId, consultation_id: consultationId });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setM(EMPTY);
    qc.invalidateQueries({ queryKey: ["meds", visitId] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("medication_instructions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["meds", visitId] });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Entered by the clinician. The system does not suggest, check or dispense medicines.</p>
      {meds?.length === 0 ? <p className="text-sm text-muted-foreground">No medication instructions.</p> : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Medicine</TableHead><TableHead>Dose</TableHead><TableHead>Route</TableHead><TableHead>Frequency</TableHead><TableHead>Duration</TableHead><TableHead>Instructions</TableHead>{editable && <TableHead />}</TableRow></TableHeader>
            <TableBody>
              {meds?.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">{x.medicine}</TableCell><TableCell>{x.dose ?? "—"}</TableCell><TableCell>{x.route ?? "—"}</TableCell>
                  <TableCell>{x.frequency ?? "—"}</TableCell><TableCell>{x.duration ?? "—"}</TableCell><TableCell className="text-xs">{x.instructions ?? ""}</TableCell>
                  {editable && <TableCell><Button size="icon" variant="ghost" aria-label={`Remove ${x.medicine}`} onClick={() => remove(x.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editable && (
        <div className="grid gap-2 rounded-md border bg-secondary/30 p-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <F label="Medicine" required className="lg:col-span-2"><Input value={m.medicine} onChange={set("medicine")} maxLength={150} /></F>
          <F label="Dose"><Input value={m.dose} onChange={set("dose")} maxLength={60} placeholder="e.g. 500 mg" /></F>
          <F label="Route">
            <Select value={m.route} onValueChange={(route) => setM({ ...m, route })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{ROUTES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Frequency"><Input value={m.frequency} onChange={set("frequency")} maxLength={60} placeholder="e.g. 3 times daily" /></F>
          <F label="Duration"><Input value={m.duration} onChange={set("duration")} maxLength={60} placeholder="e.g. 5 days" /></F>
          <F label="Instructions" className="sm:col-span-2 lg:col-span-5"><Input value={m.instructions} onChange={set("instructions")} maxLength={300} placeholder="e.g. after meals" /></F>
          <Button onClick={add} disabled={busy}>Add medicine</Button>
        </div>
      )}
    </div>
  );
}
