import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useServices } from "@/lib/data";

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
    if (!service) return toast.error("Choose the reason for visit");
    setBusy(true);
    const { data, error } = await supabase.from("visits").insert({
      patient_id: patientId, service_key: service, reception_notes: notes || null,
      visit_type: appointmentId ? "appointment" : "walk_in", appointment_id: appointmentId ?? null,
    }).select("queue_number").single();
    if (!error && appointmentId) await supabase.from("appointments").update({ status: "checked_in" }).eq("id", appointmentId);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Checked in — queue number ${data.queue_number}`);
    qc.invalidateQueries();
    setOpen(false);
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm">Check in</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Check in {patientLabel}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Reason for visit / service</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
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
