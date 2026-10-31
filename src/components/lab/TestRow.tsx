import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { ReasonDialog } from "@/components/lab/ReasonDialog";
import { supabase } from "@/integrations/supabase/client";
import type { Staff } from "@/lib/auth";
import { fmtDateTime } from "@/lib/opd-queries";
import type { LabItemFull, LabRequestFull } from "@/lib/lab-queries";
import { canVerify, labResultFlag, labValueProblem, referenceText } from "@/lib/workflow";

type Amendment = LabRequestFull["lab_result_amendments"][number];
type Names = Record<string, string> | undefined;

const FLAG_LABEL: Record<string, string> = { L: "Low", H: "High", A: "Abnormal" };

export function ResultValue({ value, flag, unit }: { value: string; flag: string | null; unit: string | null }) {
  return (
    <span className={`font-semibold ${flag ? "text-destructive" : ""}`}>
      {value} {unit}{flag && <span className="ml-1 rounded bg-destructive/10 px-1 text-xs">{FLAG_LABEL[flag] ?? flag}</span>}
    </span>
  );
}

/** One ordered test: its own status, result entry by result type, verification and corrections. */
export function TestRow({ item, me, names, amendments, accession, onChange }: {
  item: LabItemFull; me: Staff; names: Names; amendments: Amendment[]; accession: string | undefined; onChange: () => void;
}) {
  const t = item.lab_tests!;
  const res = item.lab_results;
  const isTech = me.roles.includes("laboratory_technician");
  const [value, setValue] = useState(res?.value ?? "");
  const [comment, setComment] = useState(res?.comment ?? "");
  const [abn, setAbn] = useState(res?.abnormal_flag === "A");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "cancel" | "return" | "amend">(null);
  const nm = (id: string | null | undefined) => (id ? names?.[id] ?? "—" : "—");
  const editable = isTech && (item.status === "processing" || item.status === "entered");
  const ref = referenceText(res && item.status !== "processing" ? res : { ...t, unit: t.unit });
  const preview = value.trim() && !labValueProblem(t, value) ? labResultFlag(t, value, abn) : null;
  const verifyOk = canVerify({ enteredBy: res?.entered_by, userId: me.id, canVerifyLab: me.canVerifyLab, canSelfVerify: me.canSelfVerify });

  async function setStatus(patch: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await supabase.from("lab_request_items").update(patch as never).eq("id", item.id);
    setBusy(false);
    if (error) { toast.error(error.message); onChange(); return false; }
    toast.success(ok); onChange(); return true;
  }

  async function save() {
    const problem = labValueProblem(t, value);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const { error } = await supabase.rpc("save_lab_result", {
      _item_id: item.id, _value: value.trim(), _comment: comment.trim(),
      _flag: (t.result_type === "text" || t.result_type === "microscopy") && abn ? "A" : "",
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${t.name}: result saved (not yet verified)`);
    onChange();
  }

  const input = t.result_type === "qualitative" && t.result_options?.length ? (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger className="w-48" aria-label={`${t.name} result`}><SelectValue placeholder="Choose result" /></SelectTrigger>
      <SelectContent>{t.result_options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
    </Select>
  ) : t.result_type === "microscopy" ? (
    <Textarea className="min-w-64" rows={2} aria-label={`${t.name} microscopy findings`} placeholder="Microscopy findings" maxLength={2000} value={value} onChange={(e) => setValue(e.target.value)} />
  ) : (
    <Input className={t.result_type === "numeric" ? "w-32" : "w-64"} inputMode={t.result_type === "numeric" ? "decimal" : undefined} aria-label={`${t.name} result`}
      placeholder={t.result_type === "numeric" ? "Number" : "Result"} maxLength={t.result_type === "numeric" ? 20 : 300} value={value} onChange={(e) => setValue(e.target.value)} />
  );

  const steps: [string, string | null | undefined, string | null | undefined][] = [
    ["Collected", item.collected_at, item.collected_by], ["Received", item.received_at, item.received_by],
    ["Processing", item.processed_at, item.processed_by], ["Result entered", res?.entered_at, res?.entered_by],
    ["Submitted", item.submitted_at, item.submitted_by], ["Verified", item.verified_at, item.verified_by],
    ["Cancelled", item.cancelled_at, item.cancelled_by],
  ];

  return (
    <div className={`grid gap-3 p-3 lg:grid-cols-[220px_1fr_auto] ${item.status === "rejected" ? "bg-destructive/5" : ""}`}>
      <div>
        <div className="font-medium">{t.name}</div>
        <div className="text-xs text-muted-foreground">{t.section}{accession && <> · <span className="font-mono">{accession}</span></>}</div>
        {t.catalogue_note && <div className="mt-0.5 text-[11px] text-warning-foreground">{t.catalogue_note}</div>}
        <div className="mt-1"><StatusBadge status={item.status} /></div>
      </div>

      <div className="space-y-1 text-sm">
        {editable ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {input}
              {t.result_type === "numeric" && <span className="text-xs text-muted-foreground">{t.unit ?? "unit not configured"}</span>}
              {preview && <span className="rounded bg-destructive/10 px-1.5 text-xs font-semibold text-destructive">{FLAG_LABEL[preview]}</span>}
              {(t.result_type === "text" || t.result_type === "microscopy") && (
                <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={abn} onCheckedChange={(c) => setAbn(c === true)} />Mark abnormal</label>
              )}
            </div>
            <Input className="max-w-md" placeholder="Laboratory remark (optional)" aria-label={`${t.name} remark`} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="text-xs text-muted-foreground">Reference: {ref || "not configured"}</div>
          </div>
        ) : res && item.status !== "cancelled" ? (
          <div>
            <ResultValue value={res.value} flag={res.abnormal_flag} unit={res.unit} />
            {item.status === "verified" ? <span className="ml-2 rounded bg-success/15 px-1 text-[10px] font-semibold uppercase text-success">Final</span>
              : <span className="ml-2 rounded bg-warning/20 px-1 text-[10px] font-semibold uppercase text-warning-foreground">Preliminary — not verified</span>}
            <div className="text-xs text-muted-foreground">Reference: {referenceText(res) || "not configured"}</div>
            {res.comment && <div className="text-xs">Remark: {res.comment}</div>}
          </div>
        ) : item.status === "rejected" ? (
          <div className="text-destructive">Specimen rejected: {item.rejection_reason}. Register a new specimen to recollect.</div>
        ) : item.status === "cancelled" ? (
          <div className="text-muted-foreground">Cancelled: {item.cancel_reason}</div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {item.status === "requested" ? "Waiting for specimen collection." : item.status === "collected" ? "Waiting for receipt in the laboratory." : "Specimen received — start processing to enter the result."}
          </div>
        )}
        {item.returned_reason && ["entered", "awaiting_verification"].includes(item.status) && (
          <div className="rounded border border-warning/50 bg-warning/10 px-2 py-1 text-xs"><b>Returned for correction:</b> {item.returned_reason}</div>
        )}
        <div className="text-[11px] text-muted-foreground">
          {steps.filter(([, at]) => at).map(([label, at, by]) => `${label} ${fmtDateTime(at)} by ${nm(by)}`).join(" · ")}
        </div>
        {amendments.length > 0 && (
          <div className="rounded border border-primary/20 bg-secondary/40 p-2 text-xs">
            <div className="font-semibold">Correction history</div>
            {amendments.map((a) => (
              <div key={a.id}>
                {fmtDateTime(a.created_at)} by {nm(a.amended_by)} — reason: {a.reason}. Previously verified value: <b>{a.previous_value} {a.previous_unit}</b>
                {a.previous_flag && ` (${FLAG_LABEL[a.previous_flag] ?? a.previous_flag})`}, verified by {nm(a.previous_verified_by)} {fmtDateTime(a.previous_verified_at)}.
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-end gap-2">
        {isTech && item.status === "received" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus({ status: "processing" }, `${t.name}: processing started`)}>Start processing</Button>}
        {editable && <Button size="sm" disabled={busy} onClick={save}>{res ? "Update result" : "Save result"}</Button>}
        {isTech && item.status === "entered" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus({ status: "awaiting_verification" }, `${t.name}: sent for verification`)}>Submit for verification</Button>}
        {isTech && item.status === "awaiting_verification" && (verifyOk
          ? <Button size="sm" disabled={busy} onClick={() => setStatus({ status: "verified" }, `${t.name}: verified and released to OPD`)}>Verify</Button>
          : <span className="max-w-40 text-xs text-muted-foreground">{me.canVerifyLab ? "Another verifier must verify (you entered it)" : "Awaiting an authorised verifier"}</span>)}
        {isTech && item.status === "awaiting_verification" && (me.canVerifyLab || res?.entered_by === me.id) && <Button size="sm" variant="ghost" onClick={() => setDialog("return")}>Return</Button>}
        {isTech && item.status === "verified" && me.canVerifyLab && <Button size="sm" variant="outline" onClick={() => setDialog("amend")}>Correct result</Button>}
        {isTech && ["requested", "collected", "received", "processing", "entered", "rejected"].includes(item.status) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")}>Cancel test</Button>}
      </div>

      <ReasonDialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)} title={`Cancel ${t.name}`}
        description="The test will not be performed. OPD sees it as cancelled with your reason." confirmLabel="Cancel test" destructive
        onConfirm={(reason) => setStatus({ status: "cancelled", cancel_reason: reason }, `${t.name} cancelled`)} />
      <ReasonDialog open={dialog === "return"} onOpenChange={(o) => !o && setDialog(null)} title={`Return ${t.name} for correction`}
        confirmLabel="Return for correction" onConfirm={(reason) => setStatus({ status: "entered", returned_reason: reason }, "Returned for correction")} />
      <ReasonDialog open={dialog === "amend"} onOpenChange={(o) => !o && setDialog(null)} title={`Correct verified result: ${t.name}`}
        description="The verified value is kept permanently in the correction history. The corrected result must be entered and verified again before OPD sees it as final."
        label="Reason for correction" confirmLabel="Start correction"
        onConfirm={async (reason) => {
          const { error } = await supabase.rpc("amend_lab_result", { _item_id: item.id, _reason: reason });
          if (error) { toast.error(error.message); return false; }
          toast.success("Correction started — enter the corrected result"); onChange(); return true;
        }} />
    </div>
  );
}
