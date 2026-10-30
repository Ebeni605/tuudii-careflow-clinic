import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AGE_UNITS, EMPTY_PATIENT, ETHIOPIA_REGIONS, ageInYears, clinicToday, patientSchema, type PatientFormValues,
} from "@/lib/patient-schema";

type Errors = Partial<Record<keyof PatientFormValues, string>>;

export function PatientForm({ initial, onSubmit, busy, submitLabel, extra }: {
  initial?: Partial<PatientFormValues>;
  onSubmit: (v: PatientFormValues) => void;
  busy?: boolean;
  submitLabel: string;
  /** Extra fields rendered above the submit button (e.g. correction reason). */
  extra?: ReactNode;
}) {
  const [v, setV] = useState<PatientFormValues>({ ...EMPTY_PATIENT, ...initial });
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: keyof PatientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV({ ...v, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };
  const years = ageInYears(v);
  const isChild = years !== null && years < 18;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = patientSchema.safeParse(v);
    if (!r.success) {
      const fe = r.error.flatten().fieldErrors as Record<string, string[]>;
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m[0]])) as Errors);
      return;
    }
    setErrors({});
    onSubmit(v);
  }

  const errCount = Object.values(errors).filter(Boolean).length;

  return (
    <form className="space-y-6" onSubmit={submit} noValidate>
      <Section title="Name">
        <F label="First / given name *" error={errors.first_name}><Input value={v.first_name} onChange={set("first_name")} maxLength={60} autoFocus /></F>
        <F label="Father's name *" error={errors.middle_name}><Input value={v.middle_name} onChange={set("middle_name")} maxLength={60} /></F>
        <F label="Grandfather's name (optional)" error={errors.last_name}><Input value={v.last_name} onChange={set("last_name")} maxLength={60} /></F>
      </Section>

      <Section title="Sex and age">
        <F label="Sex *" error={errors.sex}>
          <Select value={v.sex} onValueChange={(s) => { setV({ ...v, sex: s as "male" }); setErrors({ ...errors, sex: undefined }); }}>
            <SelectTrigger aria-label="Sex"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent>
          </Select>
        </F>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Age *</Label>
          <RadioGroup className="flex flex-wrap gap-4" value={v.dob_mode} onValueChange={(m) => setV({ ...v, dob_mode: m as "dob" })}>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="dob" />Date of birth known</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="estimated" />Estimate age</label>
          </RadioGroup>
          {v.dob_mode === "dob" ? (
            <div><Input aria-label="Date of birth" type="date" max={clinicToday()} value={v.date_of_birth} onChange={set("date_of_birth")} className="max-w-xs" />
              {errors.date_of_birth && <Err>{errors.date_of_birth}</Err>}</div>
          ) : (
            <div>
              <div className="flex max-w-xs gap-2">
                <Input aria-label="Estimated age" type="number" min={0} max={130} value={v.estimated_age} onChange={set("estimated_age")} />
                <Select value={v.estimated_age_unit} onValueChange={(u) => setV({ ...v, estimated_age_unit: u as "years" })}>
                  <SelectTrigger aria-label="Age unit" className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{AGE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {errors.estimated_age && <Err>{errors.estimated_age}</Err>}
            </div>
          )}
        </div>
      </Section>

      <Section title="Contact and address">
        <F label="Phone (optional)" error={errors.phone}><Input value={v.phone} onChange={set("phone")} inputMode="tel" maxLength={20} placeholder="09…" /></F>
        <F label="Region" error={errors.region}>
          <Select value={v.region} onValueChange={(r) => setV({ ...v, region: r })}>
            <SelectTrigger aria-label="Region"><SelectValue placeholder="Select region" /></SelectTrigger>
            <SelectContent>{ETHIOPIA_REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Town" error={errors.town}><Input value={v.town} onChange={set("town")} maxLength={80} /></F>
        <F label="Kebele" error={errors.kebele}><Input value={v.kebele} onChange={set("kebele")} maxLength={40} /></F>
        <div className="md:col-span-2"><F label="Address details" error={errors.address}><Input value={v.address} onChange={set("address")} maxLength={200} /></F></div>
      </Section>

      {(isChild || v.guardian_name) && (
        <Section title={`Guardian${years !== null && years < 15 ? " (required for children under 15)" : ""}`}>
          <F label="Guardian name" error={errors.guardian_name}><Input value={v.guardian_name} onChange={set("guardian_name")} maxLength={100} /></F>
          <F label="Relationship" error={errors.guardian_relationship}><Input value={v.guardian_relationship} onChange={set("guardian_relationship")} maxLength={40} placeholder="Mother, father…" /></F>
          <F label="Guardian phone" error={errors.guardian_phone}><Input value={v.guardian_phone} onChange={set("guardian_phone")} inputMode="tel" maxLength={20} /></F>
        </Section>
      )}

      <Section title="Emergency contact and alerts">
        <F label="Emergency contact name" error={errors.emergency_contact_name}><Input value={v.emergency_contact_name} onChange={set("emergency_contact_name")} maxLength={100} /></F>
        <F label="Emergency contact phone" error={errors.emergency_contact_phone}><Input value={v.emergency_contact_phone} onChange={set("emergency_contact_phone")} inputMode="tel" maxLength={20} /></F>
        <div className="md:col-span-3"><F label="Known allergies" error={errors.allergies}><Textarea value={v.allergies} onChange={set("allergies")} rows={2} maxLength={500} placeholder="Leave empty if none known" /></F></div>
      </Section>

      {extra}
      {errCount > 0 && <p className="text-sm text-destructive" role="alert">Please correct the {errCount} highlighted field{errCount > 1 ? "s" : ""}.</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold text-primary">{title}</legend>
      <div className="grid gap-4 md:grid-cols-3">{children}</div>
    </fieldset>
  );
}

function Err({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-destructive">{children}</p>;
}

function F({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className={error ? "text-destructive" : ""}>{label}</Label>
      <div className={error ? "[&_input]:border-destructive [&_button]:border-destructive" : ""}>{children}</div>
      {error && <Err>{error}</Err>}
    </div>
  );
}
