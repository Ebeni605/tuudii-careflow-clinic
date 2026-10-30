import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useStaffNames } from "@/lib/data";
import { fmtDateTime, vitalsQuery } from "@/lib/opd-queries";
import { bmi, validateVitals, type VitalsInput } from "@/lib/workflow";
import { F } from "./Field";

const FIELDS = [
  ["bp_systolic", "BP systolic", "mmHg"],
  ["bp_diastolic", "BP diastolic", "mmHg"],
  ["pulse", "Pulse rate", "beats/min"],
  ["resp_rate", "Respiratory rate", "breaths/min"],
  ["temperature", "Temperature", "°C"],
  ["spo2", "SpO₂", "%"],
  ["weight_kg", "Weight", "kg"],
  ["height_cm", "Height", "cm"],
  ["blood_glucose", "Blood glucose", "mg/dL"],
] as const;

export function VitalsPanel({ visitId, patientId, canRecord }: { visitId: string; patientId: string; canRecord: boolean }) {
  const { data: vitals, isLoading } = useQuery(vitalsQuery(visitId));
  const { data: names } = useStaffNames();
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const parsed: VitalsInput = Object.fromEntries(FIELDS.map(([k]) => [k, v[k] ? Number(v[k]) : null]));
  const previewBmi = bmi(parsed.weight_kg, parsed.height_cm);

  async function save() {
    const errs = validateVitals(parsed);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    const row = { visit_id: visitId, patient_id: patientId, ...Object.fromEntries(Object.entries(parsed).filter(([, x]) => x != null)) };
    const { error } = await supabase.from("vital_signs").insert(row as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Vital signs recorded");
    setV({});
    qc.invalidateQueries({ queryKey: ["vitals", visitId] });
    qc.invalidateQueries({ queryKey: ["clinical_history", patientId] });
  }

  return (
    <div className="space-y-4">
      {canRecord && (
        <div className="rounded-md border bg-secondary/30 p-3">
          <div className="mb-2 text-sm font-semibold text-primary">New measurement</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {FIELDS.map(([k, label, unit]) => (
              <F key={k} label={`${label} (${unit})`}>
                <Input type="number" inputMode="decimal" step="any" value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
              </F>
            ))}
            <F label="BMI (kg/m², calculated)">
              <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm font-semibold">{previewBmi ?? "—"}</div>
            </F>
          </div>
          {errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-destructive" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Record vital signs"}</Button>
            <span className="text-xs text-muted-foreground">Each measurement is kept with its time and staff name; earlier readings are never replaced.</span>
          </div>
        </div>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : vitals?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No vital signs recorded for this visit.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / time</TableHead><TableHead>BP (mmHg)</TableHead><TableHead>Pulse</TableHead><TableHead>RR</TableHead>
                <TableHead>Temp (°C)</TableHead><TableHead>SpO₂ %</TableHead><TableHead>Wt (kg)</TableHead><TableHead>Ht (cm)</TableHead>
                <TableHead>BMI</TableHead><TableHead>Glucose</TableHead><TableHead>Recorded by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vitals?.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(x.recorded_at)}</TableCell>
                  <TableCell className="font-semibold">{x.bp_systolic != null ? `${x.bp_systolic}/${x.bp_diastolic}` : "—"}</TableCell>
                  <TableCell>{x.pulse ?? "—"}</TableCell>
                  <TableCell>{x.resp_rate ?? "—"}</TableCell>
                  <TableCell>{x.temperature ?? "—"}</TableCell>
                  <TableCell>{x.spo2 ?? "—"}</TableCell>
                  <TableCell>{x.weight_kg ?? "—"}</TableCell>
                  <TableCell>{x.height_cm ?? "—"}</TableCell>
                  <TableCell>{x.bmi ?? "—"}</TableCell>
                  <TableCell>{x.blood_glucose != null ? `${x.blood_glucose} mg/dL` : "—"}</TableCell>
                  <TableCell className="text-xs">{names?.[x.recorded_by ?? ""] ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
