import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { LabRequestForm } from "@/components/LabRequestForm";
import { supabase } from "@/integrations/supabase/client";
import { patientName, useLiveTable, useServices } from "@/lib/data";
import { useStaff } from "@/lib/auth";
import { SERVICE_TEMPLATES, type TemplateField } from "@/lib/templates";
import { ageFromDob, isResultVisibleToClinician, type LabItemStatus } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/opd/visit/$visitId")({
  head: () => ({ meta: [{ title: "Consultation — Two D Medium Clinic" }] }),
  component: () => <RequireArea area="opd"><Consultation /></RequireArea>,
});

type Consult = {
  chief_complaint: string; history: string; past_history: string; examination: string;
  treatment_notes: string; follow_up_date: string; follow_up_plan: string; template_data: Record<string, unknown>;
};
const EMPTY: Consult = { chief_complaint: "", history: "", past_history: "", examination: "", treatment_notes: "", follow_up_date: "", follow_up_plan: "", template_data: {} };

function Consultation() {
  const { visitId } = Route.useParams();
  const { data: me } = useStaff();
  const { data: services } = useServices();
  const qc = useQueryClient();
  const canEdit = !!me?.roles.includes("clinician");
  useLiveTable("lab_request_items", [["visit_labs", visitId]]);

  const { data: visit, refetch: refetchVisit } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: async () => (await supabase.from("visits").select("*, patients(*)").eq("id", visitId).single()).data,
  });
  const { data: consult } = useQuery({
    queryKey: ["consult", visitId],
    queryFn: async () => (await supabase.from("consultations").select("*").eq("visit_id", visitId).maybeSingle()).data,
  });
  const { data: vitals, refetch: refetchVitals } = useQuery({
    queryKey: ["vitals", visitId],
    queryFn: async () => (await supabase.from("vital_signs").select("*").eq("visit_id", visitId).order("recorded_at", { ascending: false })).data ?? [],
  });
  const { data: dx, refetch: refetchDx } = useQuery({
    queryKey: ["dx", visitId],
    queryFn: async () => (await supabase.from("diagnoses").select("*").eq("visit_id", visitId).order("created_at")).data ?? [],
  });
  const { data: labs } = useQuery({
    queryKey: ["visit_labs", visitId],
    queryFn: async () => (await supabase.from("lab_requests").select("*, lab_request_items(*, lab_tests(name, unit, ref_low, ref_high, ref_text))").eq("visit_id", visitId).order("created_at")).data ?? [],
  });
  const patientId = visit?.patient_id;
  const { data: history } = useQuery({
    queryKey: ["history", patientId],
    enabled: !!patientId,
    queryFn: async () => (await supabase.from("visits").select("id, checked_in_at, service_key, status, consultations(chief_complaint, treatment_notes), diagnoses(description)").eq("patient_id", patientId!).neq("id", visitId).order("checked_in_at", { ascending: false }).limit(20)).data ?? [],
  });

  const [form, setForm] = useState<Consult>(EMPTY);
  useEffect(() => {
    if (consult) setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(consult).map(([k, v]) => [k, v ?? ""])), template_data: (consult.template_data as Record<string, unknown>) ?? {} } as Consult);
  }, [consult]);

  if (!visit) return <div className="text-muted-foreground">Loading…</div>;
  const p = visit.patients!;
  const template = SERVICE_TEMPLATES[visit.service_key] ?? SERVICE_TEMPLATES.internal_medicine;
  const svcName = services?.find((s) => s.key === visit.service_key)?.name ?? visit.service_key;
  const editable = canEdit && visit.status !== "completed" && visit.status !== "cancelled";
  const pendingLab = (labs ?? []).some((l) => l.status !== "completed" && l.status !== "cancelled");

  async function save(silent = false) {
    const row = {
      visit_id: visitId, patient_id: visit!.patient_id, service_key: visit!.service_key,
      chief_complaint: form.chief_complaint || null, history: form.history || null, past_history: form.past_history || null,
      examination: form.examination || null, treatment_notes: form.treatment_notes || null,
      follow_up_date: form.follow_up_date || null, follow_up_plan: form.follow_up_plan || null,
      template_data: form.template_data as never,
    };
    const { error } = await supabase.from("consultations").upsert(row, { onConflict: "visit_id" });
    if (error) { toast.error(error.message); return false; }
    if (!silent) toast.success("Consultation saved");
    qc.invalidateQueries({ queryKey: ["consult", visitId] });
    return true;
  }
  async function move(status: "in_consultation" | "completed" | "waiting") {
    if (status === "completed" && !(await save(true))) return;
    const { error } = await supabase.from("visits").update({ status }).eq("id", visitId);
    if (error) return toast.error(error.message);
    toast.success(status === "completed" ? "Visit completed" : "Status updated");
    refetchVisit();
  }

  const set = (k: keyof Consult) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <PageHeader
        title={patientName(p)}
        subtitle={`${p.mrn} · ${p.sex} · ${ageFromDob(p.date_of_birth) ?? "age unknown"} · ${svcName} · Queue #${visit.queue_number}`}
        actions={<>
          <StatusBadge status={visit.status} />
          {canEdit && visit.status === "waiting" && <Button onClick={() => move("in_consultation")}>Start consultation</Button>}
          {canEdit && visit.status === "awaiting_lab" && <Button variant="outline" onClick={() => move("in_consultation")}>Resume consultation</Button>}
          {editable && visit.status !== "waiting" && <Button variant="outline" onClick={() => save()}>Save</Button>}
          {editable && visit.status !== "waiting" && <Button onClick={() => { if (!pendingLab || confirm("Some lab tests are not finished. Complete the visit anyway?")) move("completed"); }}>Complete visit</Button>}
        </>}
      />
      {p.allergies && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /><b>Allergies:</b> {p.allergies}</div>}
      {visit.reception_notes && <div className="rounded-md border bg-card p-3 text-sm"><b>Reception note:</b> {visit.reception_notes}</div>}

      <Tabs defaultValue="consult">
        <TabsList className="flex-wrap">
          <TabsTrigger value="vitals">Vitals</TabsTrigger>
          <TabsTrigger value="consult">{template.title}</TabsTrigger>
          <TabsTrigger value="dx">Diagnosis</TabsTrigger>
          <TabsTrigger value="lab">Lab request</TabsTrigger>
          <TabsTrigger value="results">Results {pendingLab && "•"}</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="vitals">
          <Card><CardContent className="space-y-4 p-4">
            {editable && <VitalsForm visitId={visitId} patientId={visit.patient_id} onSaved={refetchVitals} />}
            <div className="divide-y text-sm">
              {vitals?.length === 0 && <p className="text-muted-foreground">No vitals recorded.</p>}
              {vitals?.map((v) => (
                <div key={v.id} className="flex flex-wrap gap-x-5 gap-y-1 py-2">
                  <span className="text-muted-foreground">{new Date(v.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {v.bp_systolic != null && <span>BP <b>{v.bp_systolic}/{v.bp_diastolic}</b></span>}
                  {v.pulse != null && <span>PR <b>{v.pulse}</b></span>}
                  {v.temperature != null && <span>T <b>{v.temperature}°C</b></span>}
                  {v.resp_rate != null && <span>RR <b>{v.resp_rate}</b></span>}
                  {v.spo2 != null && <span>SpO₂ <b>{v.spo2}%</b></span>}
                  {v.weight_kg != null && <span>Wt <b>{v.weight_kg} kg</b></span>}
                  {v.height_cm != null && <span>Ht <b>{v.height_cm} cm</b></span>}
                  {v.blood_glucose != null && <span>Glucose <b>{v.blood_glucose} mg/dL</b></span>}
                </div>
              ))}
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="consult">
          <Card><CardContent className="grid gap-4 p-4 md:grid-cols-2">
            <F label="Chief complaint"><Textarea disabled={!editable} rows={2} value={form.chief_complaint} onChange={set("chief_complaint")} /></F>
            <F label="History of present illness"><Textarea disabled={!editable} rows={2} value={form.history} onChange={set("history")} /></F>
            <F label="Past medical history"><Textarea disabled={!editable} rows={2} value={form.past_history} onChange={set("past_history")} /></F>
            <F label="Physical examination"><Textarea disabled={!editable} rows={2} value={form.examination} onChange={set("examination")} /></F>
            {template.fields.length > 0 && (
              <div className="md:col-span-2 rounded-md border bg-secondary/40 p-3">
                <div className="mb-3 text-sm font-semibold text-primary">{template.title} details</div>
                <div className="grid gap-3 md:grid-cols-3">
                  {template.fields.map((f) => (
                    <TemplateInput key={f.key} field={f} disabled={!editable} value={form.template_data[f.key]}
                      onChange={(val) => setForm({ ...form, template_data: { ...form.template_data, [f.key]: val } })} />
                  ))}
                </div>
              </div>
            )}
            <div className="md:col-span-2"><F label="Treatment notes / plan"><Textarea disabled={!editable} rows={3} value={form.treatment_notes} onChange={set("treatment_notes")} /></F></div>
            <F label="Follow-up date"><Input disabled={!editable} type="date" value={form.follow_up_date} onChange={set("follow_up_date")} /></F>
            <F label="Follow-up plan"><Input disabled={!editable} value={form.follow_up_plan} onChange={set("follow_up_plan")} /></F>
            {editable && visit.status !== "waiting" && <div><Button onClick={() => save()}>Save consultation</Button></div>}
            {editable && visit.status === "waiting" && <p className="text-sm text-muted-foreground md:col-span-2">Start the consultation to record notes.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="dx">
          <Card><CardContent className="space-y-3 p-4">
            {dx?.length === 0 && <p className="text-sm text-muted-foreground">No diagnosis recorded.</p>}
            {dx?.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <div><span className="mr-2 rounded bg-secondary px-1.5 text-xs capitalize">{d.diagnosis_type}</span>{d.description} {d.icd10_code && <span className="font-mono text-xs text-muted-foreground">({d.icd10_code})</span>}</div>
                {editable && <Button size="icon" variant="ghost" aria-label="Remove" onClick={async () => { await supabase.from("diagnoses").delete().eq("id", d.id); refetchDx(); }}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            {editable && visit.status !== "waiting" && <DxForm visitId={visitId} patientId={visit.patient_id} onSaved={refetchDx} />}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="lab">
          <Card><CardContent className="p-4">
            {editable && visit.status !== "waiting" ? <LabRequestForm visitId={visitId} patientId={visit.patient_id} onDone={() => refetchVisit()} />
              : <p className="text-sm text-muted-foreground">Start the consultation to request laboratory tests.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="results">
          <div className="space-y-3">
            {labs?.length === 0 && <Card><CardContent className="p-4 text-sm text-muted-foreground">No lab requests for this visit.</CardContent></Card>}
            {labs?.map((l) => (
              <Card key={l.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm">{l.request_number} {l.priority === "urgent" && <StatusBadge status="urgent" label="Urgent" />}</CardTitle>
                  <div className="flex items-center gap-2"><StatusBadge status={l.status} />{l.status === "completed" && <Link className="text-xs text-primary hover:underline" to="/lab/report/$requestId" params={{ requestId: l.id }}>Print report</Link>}</div>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <tbody className="divide-y">
                      {l.lab_request_items.map((i) => {
                        const visible = isResultVisibleToClinician(i.status as LabItemStatus);
                        const t = i.lab_tests;
                        return (
                          <tr key={i.id}>
                            <td className="py-1.5">{t?.name}</td>
                            <td className={`py-1.5 font-semibold ${i.abnormal_flag ? "text-destructive" : ""}`}>
                              {visible ? <>{i.result_value} {t?.unit} {i.abnormal_flag && `(${i.abnormal_flag})`}</> : <StatusBadge status={i.status} />}
                            </td>
                            <td className="py-1.5 text-xs text-muted-foreground">{t?.ref_low != null ? `${t.ref_low}–${t.ref_high}` : t?.ref_text}</td>
                            <td className="py-1.5 text-xs text-muted-foreground">{i.status === "rejected" ? `Rejected: ${i.rejection_reason}` : visible ? i.result_comment : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card><CardContent className="divide-y p-4 text-sm">
            {history?.length === 0 && <p className="text-muted-foreground">No previous visits.</p>}
            {history?.map((h) => (
              <div key={h.id} className="py-2">
                <div className="flex justify-between"><b>{services?.find((s) => s.key === h.service_key)?.name}</b><span className="text-muted-foreground">{new Date(h.checked_in_at).toLocaleDateString()}</span></div>
                {h.consultations?.[0]?.chief_complaint && <div><span className="text-muted-foreground">Complaint:</span> {h.consultations[0].chief_complaint}</div>}
                {h.diagnoses?.length > 0 && <div><span className="text-muted-foreground">Diagnosis:</span> {h.diagnoses.map((d) => d.description).join("; ")}</div>}
                {h.consultations?.[0]?.treatment_notes && <div><span className="text-muted-foreground">Treatment:</span> {h.consultations[0].treatment_notes}</div>}
                <Link className="text-xs text-primary hover:underline" to="/opd/visit/$visitId" params={{ visitId: h.id }}>Open visit</Link>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function TemplateInput({ field, value, onChange, disabled }: { field: TemplateField; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const v = (value as string) ?? "";
  if (field.type === "checkbox") {
    return <label className="flex items-center gap-2 pt-6 text-sm"><Checkbox disabled={disabled} checked={!!value} onCheckedChange={(c) => onChange(!!c)} />{field.label}</label>;
  }
  if (field.type === "select") {
    return <F label={field.label}><Select disabled={disabled} value={v} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{field.options!.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></F>;
  }
  if (field.type === "textarea") return <div className="md:col-span-3"><F label={field.label}><Textarea disabled={disabled} rows={2} value={v} onChange={(e) => onChange(e.target.value)} /></F></div>;
  return <F label={field.label}><Input disabled={disabled} type={field.type} value={v} onChange={(e) => onChange(e.target.value)} /></F>;
}

function VitalsForm({ visitId, patientId, onSaved }: { visitId: string; patientId: string; onSaved: () => void }) {
  const fields = [
    ["bp_systolic", "BP systolic"], ["bp_diastolic", "BP diastolic"], ["pulse", "Pulse (bpm)"], ["temperature", "Temp (°C)"],
    ["resp_rate", "Resp. rate"], ["spo2", "SpO₂ (%)"], ["weight_kg", "Weight (kg)"], ["height_cm", "Height (cm)"], ["blood_glucose", "Glucose (mg/dL)"],
  ] as const;
  const [v, setV] = useState<Record<string, string>>({});
  async function save() {
    const row: Record<string, number | string> = { visit_id: visitId, patient_id: patientId };
    for (const [k] of fields) if (v[k]) row[k] = Number(v[k]);
    if (Object.keys(row).length <= 2) return toast.error("Enter at least one value");
    const { error } = await supabase.from("vital_signs").insert(row as never);
    if (error) return toast.error(error.message);
    toast.success("Vitals recorded");
    setV({}); onSaved();
  }
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-9">
        {fields.map(([k, label]) => <F key={k} label={label}><Input type="number" step="any" value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></F>)}
      </div>
      <Button className="mt-3" size="sm" onClick={save}>Record vitals</Button>
    </div>
  );
}

function DxForm({ visitId, patientId, onSaved }: { visitId: string; patientId: string; onSaved: () => void }) {
  const [desc, setDesc] = useState("");
  const [icd, setIcd] = useState("");
  const [type, setType] = useState<"primary" | "secondary">("primary");
  async function add() {
    if (!desc.trim()) return;
    const { error } = await supabase.from("diagnoses").insert({ visit_id: visitId, patient_id: patientId, description: desc.trim(), icd10_code: icd.trim() || null, diagnosis_type: type });
    if (error) return toast.error(error.message);
    setDesc(""); setIcd(""); onSaved();
  }
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_140px_150px_auto] md:items-end">
      <F label="Diagnosis"><Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} /></F>
      <F label="ICD-10 (optional)"><Input value={icd} onChange={(e) => setIcd(e.target.value)} maxLength={10} /></F>
      <F label="Type"><Select value={type} onValueChange={(t) => setType(t as "primary")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="primary">Primary</SelectItem><SelectItem value="secondary">Secondary</SelectItem></SelectContent></Select></F>
      <Button onClick={add}>Add</Button>
    </div>
  );
}
