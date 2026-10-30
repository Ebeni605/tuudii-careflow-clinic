import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { today, useServices } from "@/lib/data";
import { friendlyDbError } from "@/lib/patient-schema";

export function CheckInDialog({ patientId, patientLabel, appointmentId, defaultService, trigger, onDone }: {
  patientId: string; patientLabel: string; appointmentId?: string; defaultService?: string;
  trigger?: React.ReactNode; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState(defaultService ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: services } = useServices();
  const qc = useQueryClient();

  async function submit() {
    if (!service) { toast.error("Choose the reason for visit"); return; }
    setBusy(true);
    // Queue number, visit date, check-in time and receptionist are set by the database.
    const { data, error } = await supabase.from("visits").insert({
      patient_id: patientId, service_key: service, reception_notes: notes.trim() || null,
      appointment_id: appointmentId ?? null,
    }).select("queue_number").single();
    setBusy(false);
    if (error) { toast.error(friendlyDbError(error.message)); return; }
    toast.success(`Checked in — queue number ${data.queue_number}`);
    qc.invalidateQueries();
    setOpen(false);
    setNotes("");
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm">Check in</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check in {patientLabel}</DialogTitle>
          <DialogDescription>{appointmentId ? "Appointment check-in" : "Walk-in visit"} for today, {today()}. The patient joins the shared OPD waiting list.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Reason for visit / service *</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger aria-label="Service"><SelectValue placeholder="Select service" /></SelectTrigger>
              <SelectContent>{services?.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reception notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Add to OPD queue"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
