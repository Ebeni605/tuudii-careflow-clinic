import { z } from "zod";

// Client-side checks mirror the database trigger on public.patients.
// The database stays the final authority.

export const PHONE_RE = /^\+?[0-9]{9,13}$/;

export const ETHIOPIA_REGIONS = [
  "Oromia", "Addis Ababa", "Afar", "Amhara", "Benishangul-Gumuz", "Central Ethiopia", "Dire Dawa", "Gambela",
  "Harari", "Sidama", "Somali", "South Ethiopia", "South West Ethiopia Peoples", "Tigray",
];

export const AGE_UNITS = ["years", "months", "days"] as const;

export function normalisePhone(p: string) {
  return p.replace(/[\s-]/g, "");
}

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, { message: `${label} must be ${max} characters or fewer` });

const optionalPhone = (label: string) =>
  z.string().trim().refine((v) => v === "" || PHONE_RE.test(normalisePhone(v)), {
    message: `${label} must be 9–13 digits, e.g. 0911234567`,
  });

export const patientSchema = z
  .object({
    first_name: z.string().trim().min(1, { message: "First name is required" }).max(60, { message: "First name is too long" }),
    middle_name: z.string().trim().min(1, { message: "Father's name is required" }).max(60, { message: "Father's name is too long" }),
    last_name: optionalText(60, "Grandfather's name"),
    sex: z.enum(["male", "female"], { errorMap: () => ({ message: "Select sex" }) }),
    dob_mode: z.enum(["dob", "estimated"]),
    date_of_birth: z.string(),
    estimated_age: z.string(),
    estimated_age_unit: z.enum(AGE_UNITS),
    phone: optionalPhone("Phone number"),
    region: optionalText(60, "Region"),
    town: optionalText(80, "Town"),
    kebele: optionalText(40, "Kebele"),
    address: optionalText(200, "Address"),
    guardian_name: optionalText(100, "Guardian name"),
    guardian_relationship: optionalText(40, "Relationship"),
    guardian_phone: optionalPhone("Guardian phone"),
    emergency_contact_name: optionalText(100, "Emergency contact"),
    emergency_contact_phone: optionalPhone("Emergency contact phone"),
    allergies: optionalText(500, "Allergies"),
  })
  .superRefine((v, ctx) => {
    if (v.dob_mode === "dob") {
      if (!v.date_of_birth) ctx.addIssue({ code: "custom", path: ["date_of_birth"], message: "Enter the date of birth, or switch to estimated age" });
      else if (v.date_of_birth > clinicToday()) ctx.addIssue({ code: "custom", path: ["date_of_birth"], message: "Date of birth cannot be in the future" });
    } else {
      const n = Number(v.estimated_age);
      if (v.estimated_age.trim() === "" || !Number.isInteger(n) || n < 0 || n > 130) {
        ctx.addIssue({ code: "custom", path: ["estimated_age"], message: "Enter an estimated age between 0 and 130" });
      }
    }
    const years = ageInYears(v);
    if (years !== null && years < 15 && !v.guardian_name.trim()) {
      ctx.addIssue({ code: "custom", path: ["guardian_name"], message: "Guardian name is required for children under 15" });
    }
  });

export type PatientFormValues = z.input<typeof patientSchema>;

/** Today's date in the clinic's time zone (Ethiopia), as YYYY-MM-DD. */
export function clinicToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Approximate age in years from either DOB or an estimate; null when unknown. */
export function ageInYears(v: Pick<PatientFormValues, "dob_mode" | "date_of_birth" | "estimated_age" | "estimated_age_unit">, now = new Date()) {
  if (v.dob_mode === "estimated") {
    const n = Number(v.estimated_age);
    if (v.estimated_age.trim() === "" || Number.isNaN(n)) return null;
    return v.estimated_age_unit === "years" ? n : v.estimated_age_unit === "months" ? n / 12 : n / 365;
  }
  if (!v.date_of_birth) return null;
  return (now.getTime() - new Date(v.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000);
}

/** Convert form values into the row sent to the database. */
export function toPatientRow(v: PatientFormValues) {
  const n = (s: string) => (s.trim() === "" ? null : s.trim());
  const estimated = v.dob_mode === "estimated";
  return {
    first_name: v.first_name.trim(),
    middle_name: v.middle_name.trim(),
    last_name: v.last_name.trim(),
    sex: v.sex,
    dob_estimated: estimated,
    date_of_birth: estimated ? null : n(v.date_of_birth),
    estimated_age: estimated ? Number(v.estimated_age) : null,
    estimated_age_unit: estimated ? v.estimated_age_unit : null,
    phone: n(normalisePhone(v.phone)),
    region: n(v.region),
    town: n(v.town),
    kebele: n(v.kebele),
    address: n(v.address),
    guardian_name: n(v.guardian_name),
    guardian_relationship: n(v.guardian_relationship),
    guardian_phone: n(normalisePhone(v.guardian_phone)),
    emergency_contact_name: n(v.emergency_contact_name),
    emergency_contact_phone: n(normalisePhone(v.emergency_contact_phone)),
    allergies: n(v.allergies),
  };
}

export const EMPTY_PATIENT: PatientFormValues = {
  first_name: "", middle_name: "", last_name: "", sex: "" as never, dob_mode: "dob", date_of_birth: "",
  estimated_age: "", estimated_age_unit: "years", phone: "", region: "", town: "", kebele: "", address: "",
  guardian_name: "", guardian_relationship: "", guardian_phone: "", emergency_contact_name: "",
  emergency_contact_phone: "", allergies: "",
};

type PatientRow = {
  first_name: string; middle_name: string | null; last_name: string; sex: string; date_of_birth: string | null;
  dob_estimated: boolean; estimated_age: number | null; estimated_age_unit: string | null; phone: string | null;
  region: string | null; town: string | null; kebele: string | null; address: string | null;
  guardian_name: string | null; guardian_relationship: string | null; guardian_phone: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null; allergies: string | null;
};

export function fromPatientRow(p: PatientRow): PatientFormValues {
  const s = (x: string | null | undefined) => x ?? "";
  return {
    first_name: p.first_name, middle_name: s(p.middle_name), last_name: s(p.last_name), sex: p.sex as "male",
    dob_mode: p.dob_estimated ? "estimated" : "dob", date_of_birth: s(p.date_of_birth),
    estimated_age: p.estimated_age != null ? String(p.estimated_age) : "",
    estimated_age_unit: (p.estimated_age_unit as "years") ?? "years",
    phone: s(p.phone), region: s(p.region), town: s(p.town), kebele: s(p.kebele), address: s(p.address),
    guardian_name: s(p.guardian_name), guardian_relationship: s(p.guardian_relationship), guardian_phone: s(p.guardian_phone),
    emergency_contact_name: s(p.emergency_contact_name), emergency_contact_phone: s(p.emergency_contact_phone),
    allergies: s(p.allergies),
  };
}

/** Turn database errors into plain messages for reception staff. */
export function friendlyDbError(message: string) {
  if (message.includes("visits_one_active_per_patient_day") || message.includes("already in today")) return "This patient is already in today's queue.";
  if (message.includes("appointments_one_per_day")) return "This patient already has an appointment on that day.";
  if (message.includes("visits_one_per_appointment")) return "This appointment has already been checked in.";
  if (message.includes("billing_one_reversal_per_payment")) return "This payment has already been reversed.";
  if (message.includes("row-level security")) return "Your role is not allowed to do this.";
  return message;
}
