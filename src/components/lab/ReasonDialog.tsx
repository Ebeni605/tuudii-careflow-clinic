import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Asks for a required reason (rejection, cancellation, return, correction) before an action. */
export function ReasonDialog({
  open, onOpenChange, title, description, label = "Reason", confirmLabel, destructive, onConfirm, children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<boolean | void>;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!reason.trim()) return;
    setBusy(true);
    const ok = await onConfirm(reason.trim());
    setBusy(false);
    if (ok !== false) { setReason(""); onOpenChange(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setReason(""); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <div className="space-y-1.5">
          <Label htmlFor="reason-text">{label} *</Label>
          <Textarea id="reason-text" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Back</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={!reason.trim() || busy} onClick={go}>{busy ? "Saving…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
