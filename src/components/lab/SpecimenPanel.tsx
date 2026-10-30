import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { ReasonDialog } from "@/components/lab/ReasonDialog";
import { supabase } from "@/integrations/supabase/client";
import { SAMPLE_CONDITIONS, SPECIMEN_STATUS_LABEL } from "@/lib/data";
import { fmtDateTime } from "@/lib/opd-queries";
import type { LabRequestFull, LabSpecimen } from "@/lib/lab-queries";

/** Current clinic (Addis Ababa) time as a datetime-local value. */
function addisNowLocal() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Africa/Addis_Ababa" }).replace(" ", "T").slice(0, 16);
}

function ConditionSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label="Sample condition"><SelectValue placeholder="Choose the sample condition" /></SelectTrigger>
      <SelectContent>{SAMPLE_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Specimen registration, receipt, rejection and recollection history for one request. */
export function SpecimenPanel({ req, isTech, myId, names, onChange }: {
  req: LabRequestFull; isTech: boolean; myId: string; names: Record<string, string> | undefined; onChange: () => void;
}) {
  const items = req.lab_request_items;
  const waiting = items.filter((i) => i.status === "requested" || i.status === "rejected");
  const itemName = (id: string) => items.find((i) => i.id === id)?.lab_tests?.name ?? "?";
  const specimens = [...req.lab_specimens].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const byId = Object.fromEntries(specimens.map((s) => [s.id, s]));

  const [collectOpen, setCollectOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [type, setType] = useState("");
  const [at, setAt] = useState(addisNowLocal());
  const [by, setBy] = useState(myId);
  const [receivedNow, setReceivedNow] = useState(true);
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState<LabSpecimen | null>(null);
  const [recvCondition, setRecvCondition] = useState("");
  const [rejecting, setRejecting] = useState<LabSpecimen | null>(null);
  const [rejectCondition, setRejectCondition] = useState("");

  const typeGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of waiting) {
      const t = i.lab_tests?.specimen_type ?? "Not set in catalogue";
      m.set(t, [...(m.get(t) ?? []), i.id]);
    }
    return [...m.entries()];
  }, [waiting]);

  function openCollect(ids?: string[], t?: string) {
    setSel(new Set(ids ?? waiting.map((i) => i.id)));
    setType(t && t !== "Not set in catalogue" ? t : "");
    setAt(addisNowLocal()); setBy(myId); setReceivedNow(true); setCondition(""); setNotes("");
    setCollectOpen(true);
  }

  async function collect() {
    if (!sel.size) { toast.error("Tick the tests this specimen is for"); return; }
    if (!type.trim()) { toast.error("Enter the specimen type"); return; }
    if (receivedNow && !condition) { toast.error("Record the sample condition"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("collect_specimen", {
      _request_id: req.id, _item_ids: [...sel], _specimen_type: type.trim(),
      _collected_at: new Date(`${at}:00+03:00`).toISOString(), _collected_by: by,
      _received: receivedNow, _condition: receivedNow ? condition : "", _notes: notes.trim(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Specimen ${(data as { accession_number?: string } | null)?.accession_number ?? ""} registered`);
    setCollectOpen(false);
    onChange();
  }

  async function receive() {
    if (!receiving || !recvCondition) { toast.error("Record the sample condition"); return; }
    const { error } = await supabase.rpc("receive_specimen", { _specimen_id: receiving.id, _condition: recvCondition });
    if (error) { toast.error(error.message); return; }
    toast.success(`Specimen ${receiving.accession_number} received`);
    setReceiving(null); onChange();
  }

  const collectableDialog = (
    <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register specimen</DialogTitle>
          <DialogDescription>A unique specimen (accession) number is created automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Tests taken on this specimen *</div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {waiting.map((i) => (
                <label key={i.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={sel.has(i.id)} onCheckedChange={() => { const n = new Set(sel); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); setSel(n); }} />
                  {i.lab_tests?.name} <span className="text-xs text-muted-foreground">({i.lab_tests?.specimen_type ?? "type not set"}){i.status === "rejected" && " · recollection"}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sp-type">Specimen type *</Label>
              <Input id="sp-type" list="sp-types" value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. Whole blood (EDTA)" maxLength={80} />
              <datalist id="sp-types">{[...new Set(items.map((i) => i.lab_tests?.specimen_type).filter(Boolean))].map((t) => <option key={t!} value={t!} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-at">Collection date and time *</Label>
              <Input id="sp-at" type="datetime-local" value={at} max={addisNowLocal()} onChange={(e) => setAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-by">Collected by *</Label>
            <Select value={by} onValueChange={setBy}>
              <SelectTrigger id="sp-by" aria-label="Collected by"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(names ?? {}).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => <SelectItem key={id} value={id}>{n}{id === myId ? " (me)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={receivedNow} onCheckedChange={setReceivedNow} />Received in the laboratory now</label>
          {receivedNow && (
            <div className="space-y-1.5"><Label htmlFor="sp-cond">Sample condition on receipt *</Label><ConditionSelect id="sp-cond" value={condition} onChange={setCondition} /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="sp-notes">Notes</Label><Textarea id="sp-notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCollectOpen(false)}>Back</Button>
          <Button onClick={collect} disabled={busy}>{busy ? "Saving…" : "Register specimen"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><TestTube className="h-4 w-4 text-primary" />Specimens</CardTitle>
        {isTech && waiting.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {typeGroups.length > 1 && typeGroups.map(([t, ids]) => (
              <Button key={t} size="sm" variant="outline" onClick={() => openCollect(ids, t)}>Collect {t} ({ids.length})</Button>
            ))}
            <Button size="sm" onClick={() => openCollect(undefined, typeGroups.length === 1 ? typeGroups[0]?.[0] : undefined)}>Register specimen</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {specimens.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">No specimen registered yet. {waiting.length > 0 && `${waiting.length} test(s) waiting for collection.`}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">Specimen no.</th><th>Type</th><th>Tests</th><th>Collected</th><th>Received / condition</th><th>Status</th><th />
              </tr></thead>
              <tbody className="divide-y">
                {specimens.map((s) => {
                  const linked = s.lab_specimen_tests.map((l) => l.item_id);
                  const resultStarted = items.some((i) => i.current_specimen_id === s.id && ["entered", "awaiting_verification", "verified"].includes(i.status));
                  return (
                    <tr key={s.id} className={s.status === "rejected" ? "bg-destructive/5" : ""}>
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{s.accession_number}
                        {s.replaces_specimen_id && <div className="font-sans text-[11px] font-normal text-muted-foreground">Recollection of {byId[s.replaces_specimen_id]?.accession_number}</div>}
                      </td>
                      <td>{s.specimen_type}</td>
                      <td className="text-xs">{linked.map(itemName).join(", ")}</td>
                      <td className="text-xs">{fmtDateTime(s.collected_at)}<div className="text-muted-foreground">{names?.[s.collected_by ?? ""] ?? "—"}</div></td>
                      <td className="text-xs">{s.received_at ? <>{fmtDateTime(s.received_at)}<div className="text-muted-foreground">{names?.[s.received_by ?? ""] ?? "—"}</div></> : "—"}
                        {s.condition && <div className={s.condition === "Acceptable" ? "" : "font-medium text-destructive"}>Condition: {s.condition}</div>}
                        {s.notes && <div className="text-muted-foreground">{s.notes}</div>}
                      </td>
                      <td>
                        <StatusBadge status={s.status === "collected" ? "collected" : s.status} label={SPECIMEN_STATUS_LABEL[s.status]} />
                        {s.status === "rejected" && <div className="mt-1 text-xs text-destructive">{s.rejection_reason}<div className="text-muted-foreground">{names?.[s.rejected_by ?? ""] ?? ""} · {fmtDateTime(s.rejected_at)}</div></div>}
                      </td>
                      <td className="px-3 text-right">
                        {isTech && s.status === "collected" && <Button size="sm" variant="secondary" className="mb-1 mr-1" onClick={() => { setReceiving(s); setRecvCondition(""); }}>Receive</Button>}
                        {isTech && s.status !== "rejected" && !resultStarted && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setRejecting(s); setRejectCondition(s.condition ?? ""); }}>Reject</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {collectableDialog}
      <Dialog open={!!receiving} onOpenChange={(o) => !o && setReceiving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receive specimen {receiving?.accession_number}</DialogTitle><DialogDescription>Receipt time and your name are recorded automatically.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="rc-cond">Sample condition *</Label><ConditionSelect id="rc-cond" value={recvCondition} onChange={setRecvCondition} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setReceiving(null)}>Back</Button><Button onClick={receive} disabled={!recvCondition}>Mark received</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject specimen ${rejecting?.accession_number ?? ""}`}
        description="Its tests go back to “recollect”. The rejected specimen stays in the history."
        label="Rejection reason"
        confirmLabel="Reject specimen"
        destructive
        onConfirm={async (reason) => {
          const { error } = await supabase.rpc("reject_specimen", { _specimen_id: rejecting!.id, _reason: reason, _condition: rejectCondition });
          if (error) { toast.error(error.message); return false; }
          toast.success("Specimen rejected — collect a new one");
          onChange();
          return true;
        }}
      >
        <div className="space-y-1.5"><Label htmlFor="rj-cond">Sample condition</Label><ConditionSelect id="rj-cond" value={rejectCondition} onChange={setRejectCondition} /></div>
      </ReasonDialog>
    </Card>
  );
}
