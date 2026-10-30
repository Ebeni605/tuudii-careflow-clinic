import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type PatientInput = {
  first_name: string; middle_name: string; last_name: string; sex: string; date_of_birth: string;
  phone: string; address: string; kebele: string; woreda: string;
  emergency_contact_name: string; emergency_contact_phone: string; allergies: string;
};

const EMPTY: PatientInput = {
  first_name: "", middle_name: "", last_name: "", sex: "", date_of_birth: "", phone: "", address: "",
  kebele: "", woreda: "", emergency_contact_name: "", emergency_contact_phone: "", allergies: "",
};

export function toPatientRow(v: PatientInput) {
  const n = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    first_name: v.first_name.trim(), middle_name: n(v.middle_name), last_name: v.last_name.trim(),
    sex: v.sex, date_of_birth: n(v.date_of_birth), phone: n(v.phone), address: n(v.address),
    kebele: n(v.kebele), woreda: n(v.woreda), emergency_contact_name: n(v.emergency_contact_name),
    emergency_contact_phone: n(v.emergency_contact_phone), allergies: n(v.allergies),
  };
}

export function PatientForm({ initial, onSubmit, busy, submitLabel }: {
  initial?: Partial<PatientInput>; onSubmit: (v: PatientInput) => void; busy?: boolean; submitLabel: string;
}) {
  const [v, setV] = useState<PatientInput>({ ...EMPTY, ...initial });
  const [ageYears, setAgeYears] = useState("");
  const set = (k: keyof PatientInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  function applyAge(a: string) {
    setAgeYears(a);
    const n = Number(a);
    if (a && !Number.isNaN(n)) {
      const y = new Date().getFullYear() - Math.floor(n);
      setV((p) => ({ ...p, date_of_birth: `${y}-01-01` }));
    }
  }

  return (
    <form
      className="grid gap-4 md:grid-cols-3"
      onSubmit={(e) => { e.preventDefault(); if (!v.sex) return; onSubmit(v); }}
    >
      <F label="First name *"><Input value={v.first_name} onChange={set("first_name")} required maxLength={60} /></F>
      <F label="Father's name"><Input value={v.middle_name} onChange={set("middle_name")} maxLength={60} /></F>
      <F label="Grandfather's name *"><Input value={v.last_name} onChange={set("last_name")} required maxLength={60} /></F>
      <F label="Sex *">
        <Select value={v.sex} onValueChange={(s) => setV({ ...v, sex: s })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent>
        </Select>
      </F>
      <F label="Date of birth"><Input type="date" value={v.date_of_birth} max={new Date().toISOString().slice(0, 10)} onChange={set("date_of_birth")} /></F>
      <F label="…or age in years (estimate)"><Input type="number" min={0} max={120} value={ageYears} onChange={(e) => applyAge(e.target.value)} /></F>
      <F label="Phone"><Input value={v.phone} onChange={set("phone")} inputMode="tel" maxLength={20} /></F>
      <F label="Kebele"><Input value={v.kebele} onChange={set("kebele")} maxLength={40} /></F>
      <F label="Woreda / Town"><Input value={v.woreda} onChange={set("woreda")} maxLength={60} /></F>
      <div className="md:col-span-3"><F label="Address details"><Input value={v.address} onChange={set("address")} maxLength={200} /></F></div>
      <F label="Emergency contact name"><Input value={v.emergency_contact_name} onChange={set("emergency_contact_name")} maxLength={80} /></F>
      <F label="Emergency contact phone"><Input value={v.emergency_contact_phone} onChange={set("emergency_contact_phone")} maxLength={20} /></F>
      <div />
      <div className="md:col-span-3"><F label="Known allergies"><Textarea value={v.allergies} onChange={set("allergies")} rows={2} maxLength={500} placeholder="Leave empty if none known" /></F></div>
      <div className="md:col-span-3">
        {!v.sex && <p className="mb-2 text-xs text-muted-foreground">Select sex to continue.</p>}
        <Button type="submit" disabled={busy || !v.sex}>{busy ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
