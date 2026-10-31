import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSignature, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LoadError, PageHeader, PageLoading, RequireArea } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { LabRequestForm } from "@/components/LabRequestForm";
import { F, TemplateInput } from "@/components/opd/Field";
import { VitalsPanel } from "@/components/opd/VitalsPanel";
import { DiagnosisPanel } from "@/components/opd/DiagnosisPanel";
import { MedicationPanel } from "@/components/opd/MedicationPanel";
import { LabResults } from "@/components/opd/LabResults";
import { AmendmentsPanel } from "@/components/opd/AmendmentsPanel";
import { ClinicalHistory } from "@/components/opd/ClinicalHistory";
import { supabase } from "@/integrations/supabase/client";
import { patientName, today, useLiveTable, useServices, useStaffNames } from "@/lib/data";
import { consultQuery, dxQuery, fmtDate, fmtDateTime, fmtTime, visitLabsQuery, visitQuery } from "@/lib/opd-queries";
import { useStaff, requireArea } from "@/lib/auth";
import { templateFor, type TemplateField } from "@/lib/templates";
import { ageFromDob, ancEstimates, canCompleteVisit, isLabFinal, OPEN_ENCOUNTER_STATUSES, signingProblems, type VisitStatus } from "@/lib/workflow";

export const Route = createFileRoute("/_authenticated/opd/visit/$visitId")({
  beforeLoad: requireArea("opd"),
  head: () => ({ meta: [{ title: "Consultation — Two D Medium Clinic" }, { name: "description", content: "OPD consultation and encounter record." }] }),
  component: () => <RequireArea area="opd"><Encounter /></RequireArea>,
});

const TEXT_KEYS = [
  "chief_complaint", "history", "past_history", "medication_history", "allergy_history", "family_social_history",
  "examination", "assessment", "treatment_notes", "follow_up_date", "follow_up_plan", "referral_notes", "lab_review_notes",
] as const;
type TextKey = (typeof TEXT_KEYS)[number];
type Form = Record<TextKey, string> & { template_data: Record<string, unknown> };
const EMPTY: Form = { ...(Object.fromEntries(TEXT_KEYS.map((k) => [k, ""])) as Record<TextKey, string>), template_data: {} };

function Encounter() {
  const { visitId } = Route.useParams();
  const { data: me } = useStaff();
  const { data: services } = useServices();
  const { data: names } = useStaffNames();
  const qc = useQueryClient();
  const isClinician = !!me?.roles.includes("opd_clinician");
  useLiveTable("lab_request_items", [["visit_labs", visitId]]);
  useLiveTable("visits", [["visit", visitId]]);

  const { data: visit, isLoading, error, refetch } = useQuery(visitQuery(visitId));
  const { data: consult } = useQuery(consultQuery(visitId));
  const { data: dx } = useQuery(dxQuery(visitId));
  const { data: labs } = useQuery(visitLabsQuery(visitId));

  const [form, setForm] = useState<Form>(EMPTY);
  const loaded = useMemo<Form>(() => {
    if (!consult) return EMPTY;
    const f = { ...EMPTY, template_data: (consult.template_data as Record<string, unknown>) ?? {} };
    for (const k of TEXT_KEYS) f[k] = (consult[k] as string | null) ?? "";
    return f;
  }, [consult]);
  useEffect(() => setForm(loaded), [loaded]);
  const dirty = JSON.stringify(form) !== JSON.stringify(loaded);
  const [busy, setBusy] = useState(false);
  const [confirmSign, setConfirmSign] = useState(false);

  if (isLoading) return <PageLoading />;
  if (error) return <LoadError message="Could not load this visit." onRetry={() => refetch()} />;
  if (!visit) return <LoadError message="This visit was not found." />;

  const p = visit.patients!;
  const status = visit.status as VisitStatus;
  const template = templateFor(visit.service_key);
  const svcName = services?.find((s) => s.key === visit.service_key)?.name ?? visit.service_key;
  const isOpen = OPEN_ENCOUNTER_STATUSES.includes(status);
  const signed = consult?.status === "signed";
  const editable = isClinician && isOpen && !!consult && !signed;
  const allItems = (labs ?? []).flatMap((l) => l.lab_request_items);
  const pendingLab = allItems.some((i) => !isLabFinal(i.status));
  const problems = signingProblems({
    serviceKey: visit.service_key, chiefComplaint: form.chief_complaint, treatmentNotes: form.treatment_notes,
    diagnosisCount: dx?.length ?? 0, labOrderCount: labs?.length ?? 0, templateData: form.template_data,
  });
  const lbl = (k: "chief_complaint" | "history" | "examination" | "assessment", d: string) => template.labels?.[k] ?? d;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["visit", visitId] });
    qc.invalidateQueries({ queryKey: ["consult", visitId] });
    qc.invalidateQueries({ queryKey: ["opd_queue"] });
  }

  function rowFromForm() {
    const row: Record<string, unknown> = { template_data: form.template_data };
    for (const k of TEXT_KEYS) row[k] = form[k].trim() === "" ? null : form[k];
    return row;
  }

  async function saveDraft(silent = false) {
    if (!consult) return false;
    setBusy(true);
    const { error } = await supabase.from("consultations").update(rowFromForm() as never).eq("id", consult.id);
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    if (!silent) toast.success("Draft saved");
    qc.invalidateQueries({ queryKey: ["consult", visitId] });
    return true;
  }

  async function sign() {
    if (!consult) return;
    setBusy(true);
    const { error } = await supabase.from("consultations").update({ ...rowFromForm(), status: "signed" } as never).eq("id", consult.id);
    setBusy(false);
    setConfirmSign(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Consultation note signed");
    invalidate();
  }

  async function move(to: "in_consultation" | "completed") {
    if (to === "completed" && pendingLab && !confirm("Some laboratory tests are not finished. Their results will still appear on this visit and you can add a result review afterwards. Complete the visit now?")) return;
    setBusy(true);
    const { data, error } = await supabase.from("visits").update({ status: to }).eq("id", visitId).neq("status", to).select("id");
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) toast.info("This visit was already updated by someone else.");
    else toast.success(to === "completed" ? "Visit completed" : "Consultation in progress");
    invalidate();
  }

  async function openNote() {
    const { error } = await supabase.from("consultations").insert({ visit_id: visitId, patient_id: visit!.patient_id, service_key: visit!.service_key });
    if (error && !error.message.includes("consultations_visit_id_key")) { toast.error(error.message); return; }
    invalidate();
  }

  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const setT = (key: string, val: unknown) => setForm((f) => ({ ...f, template_data: { ...f.template_data, [key]: val } }));
  const ta = (k: TextKey, label: string, rows = 2, required = false) => (
    <F label={label} required={required}><Textarea disabled={!editable} rows={rows} maxLength={4000} value={form[k]} onChange={set(k)} /></F>
  );

  const groups = template.fields.reduce<Record<string, TemplateField[]>>((acc, f) => {
    (acc[f.group ?? `${template.title} details`] ??= []).push(f);
    return acc;
  }, {});
  const anc = visit.service_key === "anc" && typeof form.template_data["lmp"] === "string" && form.template_data["lmp"]
    ? ancEstimates(form.template_data["lmp"] as string, today()) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={patientName(p)}
        subtitle={`${p.mrn} · ${p.sex} · ${ageFromDob(p.date_of_birth, new Date(), p.dob_estimated) ?? "age unknown"} · ${svcName} · Visit #${visit.queue_number} · Checked in ${fmtTime(visit.checked_in_at)}, ${fmtDate(visit.queue_date)}`}
        actions={<>
          <StatusBadge status={visit.status} />
          {consult && <StatusBadge status={consult.status} label={signed ? "Note signed" : "Draft note"} />}
          {isClinician && status === "waiting" && <Button disabled={busy} onClick={() => move("in_consultation")}>Start consultation</Button>}
          {isClinician && (status === "awaiting_lab" || status === "ready_for_review") && !signed && <Button variant="outline" disabled={busy} onClick={() => move("in_consultation")}>Resume consultation</Button>}
          {isClinician && isOpen && !consult && <Button onClick={openNote}>Open consultation note</Button>}
          {editable && <Button variant="outline" disabled={busy || !dirty} onClick={() => saveDraft()}>{dirty ? "Save draft" : "Draft saved"}</Button>}
          {editable && <Button disabled={busy} onClick={() => setConfirmSign(true)}><FileSignature className="mr-1 h-4 w-4" />Sign note</Button>}
          {isClinician && signed && canCompleteVisit(status, consult?.status as "signed") && <Button disabled={busy} onClick={() => move("completed")}><CheckCircle2 className="mr-1 h-4 w-4" />Complete visit</Button>}
        </>}
      />

      {p.allergies && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /><b>Allergies (registration):</b> {p.allergies}</div>}
      {visit.reception_notes && <div className="rounded-md border bg-card p-3 text-sm"><b>Reception note:</b> {visit.reception_notes}</div>}
      {status === "ready_for_review" && <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success"><b>All laboratory results are back.</b> Review them in Lab orders, then record your decision in Follow-up &amp; sign.</div>}
      {status === "awaiting_lab" && <div className="rounded-md border border-accent bg-accent/40 p-3 text-sm">Waiting for laboratory results. You can keep writing the draft note.</div>}
      {signed && <div className="flex items-center gap-2 rounded-md border bg-secondary/50 p-3 text-sm"><Lock className="h-4 w-4 text-primary" />Signed by <b>{names?.[consult?.signed_by ?? ""] ?? "—"}</b> on {fmtDateTime(consult?.signed_at)}. The note can no longer be changed — add an amendment in Follow-up &amp; sign.</div>}
      {isClinician && status === "waiting" && <p className="text-sm text-muted-foreground">Start the consultation to open this visit's note. Previous records are shown below.</p>}

      <Tabs defaultValue={status === "waiting" ? "profile" : "consult"}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="profile">Patient profile</TabsTrigger>
          <TabsTrigger value="vitals">Vital signs</TabsTrigger>
          <TabsTrigger value="consult">Consultation</TabsTrigger>
          <TabsTrigger value="dx">Diagnosis &amp; treatment</TabsTrigger>
          <TabsTrigger value="lab">Lab orders {pendingLab ? "•" : ""}</TabsTrigger>
          <TabsTrigger value="sign">Follow-up &amp; sign</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Patient details</CardTitle></CardHeader>
            <CardContent className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Row k="Patient ID" v={p.mrn} /><Row k="Sex" v={p.sex} />
              <Row k={p.dob_estimated ? "Date of birth (estimated)" : "Date of birth"} v={p.date_of_birth ? `${fmtDate(p.date_of_birth)} (${ageFromDob(p.date_of_birth, new Date(), p.dob_estimated)})` : null} />
              <Row k="Phone" v={p.phone} /><Row k="Address" v={[p.town, p.region, p.kebele].filter(Boolean).join(", ")} />
              {(p.guardian_name || p.guardian_phone) && <Row k="Guardian" v={[p.guardian_name, p.guardian_relationship && `(${p.guardian_relationship})`, p.guardian_phone].filter(Boolean).join(" ")} />}
              <Row k="Emergency contact" v={[p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(" · ")} />
              <Row k="Allergies" v={p.allergies || "None recorded"} />
              <Link to="/patients/$patientId" params={{ patientId: p.id }} className="text-xs text-primary hover:underline">Full patient record</Link>
            </CardContent>
          </Card>
          <ClinicalHistory patientId={p.id} currentVisitId={visitId} />
        </TabsContent>

        <TabsContent value="vitals">
          <Card><CardContent className="p-4"><VitalsPanel visitId={visitId} patientId={p.id} canRecord={isClinician && OPEN_ENCOUNTER_STATUSES.concat("waiting").includes(status)} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="consult">
          <Card><CardContent className="space-y-4 p-4">
            {!consult && <p className="text-sm text-muted-foreground">No consultation note yet. {status === "waiting" ? "Start the consultation first." : ""}</p>}
            {consult && <>
              <div className="text-xs text-muted-foreground">Clinician: <b>{names?.[consult.clinician_id ?? ""] ?? "—"}</b> · Opened {fmtDateTime(consult.created_at)} · Last saved {fmtDateTime(consult.updated_at)}</div>
              {template.intro && <p className="rounded-md bg-secondary/50 p-2 text-sm">{template.intro}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                {ta("chief_complaint", lbl("chief_complaint", "Chief complaint"), 2, true)}
                {ta("history", lbl("history", "History of present illness"))}
                {ta("past_history", "Relevant past medical history")}
                {ta("medication_history", "Medication history")}
                {ta("allergy_history", "Allergy history")}
                {ta("family_social_history", "Family and social history (when relevant)")}
                {ta("examination", lbl("examination", "Physical examination"), 3)}
                {ta("assessment", lbl("assessment", "Clinical assessment"), 3)}
              </div>
              {Object.entries(groups).map(([g, fields]) => (
                <div key={g} className="rounded-md border bg-secondary/40 p-3">
                  <div className="mb-3 text-sm font-semibold text-primary">{g}</div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {fields.map((f) => <TemplateInput key={f.key} field={f} disabled={!editable} value={form.template_data[f.key]} onChange={(v) => setT(f.key, v)} />)}
                  </div>
                  {g === "Dates" && anc && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-warning/40 bg-warning/10 p-2 text-sm">
                      <span><b>Estimate from LMP</b> (verify before use): EDD {fmtDate(anc.edd)}, gestational age {anc.weeks} weeks {anc.days} days.</span>
                      {editable && <Button size="sm" variant="outline" onClick={() => { setT("edd", anc.edd); setT("gestational_age_weeks", anc.weeks); }}>Copy estimate into confirmed fields</Button>}
                    </div>
                  )}
                  {g === "Child and guardian" && editable && p.guardian_name && !form.template_data["guardian_name"] && (
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => { setT("guardian_name", p.guardian_name); setT("guardian_relationship", p.guardian_relationship ?? ""); setT("guardian_phone", p.guardian_phone ?? ""); }}>Use guardian details from registration</Button>
                  )}
                </div>
              ))}
              {editable && <div className="flex gap-2"><Button variant="outline" disabled={busy || !dirty} onClick={() => saveDraft()}>Save draft</Button></div>}
            </>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="dx" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Diagnosis</CardTitle></CardHeader>
            <CardContent>{consult ? <DiagnosisPanel visitId={visitId} patientId={p.id} editable={editable} /> : <p className="text-sm text-muted-foreground">Start the consultation first.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Treatment and management plan</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea aria-label="Treatment and management plan" disabled={!editable} rows={4} maxLength={4000} value={form.treatment_notes} onChange={set("treatment_notes")} />
              {editable && <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => saveDraft()}>Save draft</Button>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Medication instructions</CardTitle></CardHeader>
            <CardContent>{consult ? <MedicationPanel visitId={visitId} patientId={p.id} consultationId={consult.id} editable={editable} /> : <p className="text-sm text-muted-foreground">Start the consultation first.</p>}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lab" className="space-y-4">
          {editable && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">New laboratory order</CardTitle></CardHeader>
              <CardContent><LabRequestForm visitId={visitId} /></CardContent>
            </Card>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Orders and results <span className="font-normal text-muted-foreground">— only verified results are final</span></h3>
            <LabResults visitId={visitId} />
          </div>
        </TabsContent>

        <TabsContent value="sign" className="space-y-4">
          <Card><CardContent className="grid gap-4 p-4 md:grid-cols-2">
            {consult ? <>
              <div className="md:col-span-2">{ta("lab_review_notes", "Review of results and clinical decisions", 3)}</div>
              <F label="Follow-up date"><Input disabled={!editable} type="date" value={form.follow_up_date} onChange={set("follow_up_date")} /></F>
              {ta("follow_up_plan", "Follow-up instructions and recommendations")}
              <div className="md:col-span-2">{ta("referral_notes", "Referral notes")}</div>
            </> : <p className="text-sm text-muted-foreground">Start the consultation first.</p>}
          </CardContent></Card>

          {consult && !signed && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Sign the note</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {problems.length > 0 ? (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                    <b>Still needed before signing:</b>
                    <ul className="mt-1 list-disc pl-5">{problems.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                ) : <p className="text-success">All required parts are filled in.</p>}
                <p className="text-muted-foreground">Signing records your name and the time. After signing, the note, diagnoses and medicines cannot be changed; corrections are added as amendments.</p>
                {editable && <Button disabled={busy || problems.length > 0} onClick={() => setConfirmSign(true)}><FileSignature className="mr-1 h-4 w-4" />Sign note</Button>}
              </CardContent>
            </Card>
          )}

          {consult && signed && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Amendments</CardTitle></CardHeader>
              <CardContent><AmendmentsPanel consultationId={consult.id} visitId={visitId} patientId={p.id} canAdd={isClinician} /></CardContent>
            </Card>
          )}
          {isClinician && signed && canCompleteVisit(status, "signed") && (
            <Button disabled={busy} onClick={() => move("completed")}><CheckCircle2 className="mr-1 h-4 w-4" />Complete visit</Button>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmSign} onOpenChange={setConfirmSign}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign this consultation note?</AlertDialogTitle>
            <AlertDialogDescription>
              {problems.length > 0
                ? `Still needed: ${problems.join(", ")}.`
                : "Your name and the time will be recorded. The note, diagnoses and medication instructions will be locked; later changes must be added as amendments."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={problems.length > 0 || busy} onClick={(e) => { e.preventDefault(); sign(); }}>Sign note</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return <div className="flex gap-2"><span className="text-muted-foreground">{k}:</span><span className="font-medium">{v || "—"}</span></div>;
}
