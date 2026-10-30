// Shared clinical workflow rules. The database triggers enforce the same rules;
// this module drives which buttons the UI shows.

export type AppRole = "admin" | "receptionist" | "clinician" | "lab_tech";

export type VisitStatus =
  | "waiting"
  | "in_consultation"
  | "awaiting_lab"
  | "ready_for_review"
  | "completed"
  | "cancelled"
  | "no_show";

export type LabItemStatus =
  | "requested"
  | "collected"
  | "processing"
  | "resulted"
  | "verified"
  | "rejected";

export const VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  waiting: ["in_consultation", "cancelled", "no_show"],
  in_consultation: ["awaiting_lab", "completed", "waiting"],
  // ready_for_review is set by the database when every test of the visit is verified or rejected
  awaiting_lab: ["in_consultation", "ready_for_review", "completed"],
  ready_for_review: ["in_consultation", "awaiting_lab", "completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** Visits still in today's queue (one per patient per day). */
export const ACTIVE_VISIT_STATUSES: VisitStatus[] = ["waiting", "in_consultation", "awaiting_lab", "ready_for_review"];
/** Visits where the consultation note can be written. */
export const OPEN_ENCOUNTER_STATUSES: VisitStatus[] = ["in_consultation", "awaiting_lab", "ready_for_review"];

export const LAB_TRANSITIONS: Record<LabItemStatus, LabItemStatus[]> = {
  requested: ["collected", "rejected"],
  collected: ["processing", "rejected"],
  processing: ["resulted", "rejected"],
  resulted: ["verified", "processing"],
  verified: [],
  rejected: [],
};

export function canVisitMove(from: VisitStatus, to: VisitStatus) {
  return VISIT_TRANSITIONS[from].includes(to);
}

export function canLabMove(from: LabItemStatus, to: LabItemStatus) {
  return LAB_TRANSITIONS[from].includes(to);
}

/** A visit can be completed only once its consultation note is signed (DB trigger visit_before). */
export function canCompleteVisit(status: VisitStatus, consultStatus: "draft" | "signed" | null | undefined) {
  return canVisitMove(status, "completed") && consultStatus === "signed";
}

// ---------- Vital signs ----------

export type VitalsInput = Partial<Record<
  "bp_systolic" | "bp_diastolic" | "pulse" | "temperature" | "resp_rate" | "spo2" | "weight_kg" | "height_cm" | "blood_glucose",
  number | null
>>;

/** Plausible entry ranges (typing-error checks, not clinical judgement). Mirrors DB trigger vitals_before. */
export const VITAL_RANGES = {
  bp_systolic: [50, 260], bp_diastolic: [30, 160], pulse: [20, 250], resp_rate: [4, 80],
  temperature: [30, 45], spo2: [50, 100], weight_kg: [0.5, 300], height_cm: [30, 250], blood_glucose: [20, 800],
} as const;

export const VITAL_LABELS: Record<keyof typeof VITAL_RANGES, string> = {
  bp_systolic: "Systolic BP", bp_diastolic: "Diastolic BP", pulse: "Pulse rate", resp_rate: "Respiratory rate",
  temperature: "Temperature", spo2: "SpO₂", weight_kg: "Weight", height_cm: "Height", blood_glucose: "Blood glucose",
};

export function validateVitals(v: VitalsInput): string[] {
  const errors: string[] = [];
  const has = (k: keyof VitalsInput) => v[k] != null && !Number.isNaN(v[k]);
  if (!(Object.keys(VITAL_RANGES) as (keyof VitalsInput)[]).some(has)) errors.push("Enter at least one measurement");
  if (has("bp_systolic") !== has("bp_diastolic")) errors.push("Enter both systolic and diastolic blood pressure");
  for (const k of Object.keys(VITAL_RANGES) as (keyof typeof VITAL_RANGES)[]) {
    const val = v[k];
    if (val == null || Number.isNaN(val)) continue;
    const [lo, hi] = VITAL_RANGES[k];
    if (val < lo || val > hi) errors.push(`${VITAL_LABELS[k]} must be between ${lo} and ${hi}`);
  }
  if (has("bp_systolic") && has("bp_diastolic") && v.bp_diastolic! >= v.bp_systolic!) errors.push("Diastolic BP must be lower than systolic BP");
  return errors;
}

/** BMI (kg/m²) rounded to 1 decimal, only from valid height and weight. Mirrors the generated column vital_signs.bmi. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (weightKg == null || heightCm == null || !(weightKg > 0) || !(heightCm >= 30)) return null;
  return Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10;
}

// ---------- Signing the consultation note ----------

/** What is still missing before a note can be signed. Mirrors DB trigger consult_before. */
export function signingProblems(c: {
  serviceKey: string;
  chiefComplaint: string | null | undefined;
  treatmentNotes: string | null | undefined;
  diagnosisCount: number;
  labOrderCount: number;
  templateData: Record<string, unknown>;
}): string[] {
  const blank = (s: unknown) => typeof s !== "string" || s.trim() === "";
  const p: string[] = [];
  if (blank(c.chiefComplaint)) p.push(c.serviceKey === "laboratory" ? "clinical indication / complaint" : "chief complaint");
  if (c.serviceKey === "laboratory") {
    if (c.labOrderCount === 0) p.push("at least one laboratory order");
  } else {
    if (c.diagnosisCount === 0) p.push("at least one diagnosis");
    if (blank(c.treatmentNotes)) p.push("treatment / management plan");
  }
  if (c.serviceKey === "minor_surgery" && c.templateData.consent !== true) p.push("documented consent");
  if (c.serviceKey === "infant_circumcision") {
    if (c.templateData.guardian_consent !== true) p.push("documented guardian consent");
    if (blank(c.templateData.guardian_name)) p.push("guardian name");
  }
  return p;
}

// ---------- Antenatal estimates (shown for clinician verification only) ----------

/** EDD by Naegele's rule (LMP + 280 days) and gestational age on `onDate`. Null when LMP is in the future or > 44 weeks ago. */
export function ancEstimates(lmp: string, onDate: string): { edd: string; weeks: number; days: number } | null {
  const l = Date.parse(`${lmp}T00:00:00Z`);
  const t = Date.parse(`${onDate}T00:00:00Z`);
  if (Number.isNaN(l) || Number.isNaN(t)) return null;
  const totalDays = Math.round((t - l) / 86_400_000);
  if (totalDays < 0 || totalDays > 44 * 7) return null;
  const edd = new Date(l + 280 * 86_400_000).toISOString().slice(0, 10);
  return { edd, weeks: Math.floor(totalDays / 7), days: totalDays % 7 };
}

/** A technician may verify only results entered by someone else, unless allowed to self-verify. */
export function canVerify(opts: {
  resultedBy: string | null;
  userId: string;
  canSelfVerify: boolean;
}) {
  if (!opts.resultedBy) return false;
  return opts.resultedBy !== opts.userId || opts.canSelfVerify;
}

/** Clinicians only see lab results once verified. */
export function isResultVisibleToClinician(status: LabItemStatus) {
  return status === "verified";
}

export function abnormalFlag(
  value: string,
  low: number | null,
  high: number | null,
): "L" | "H" | null {
  const n = Number(value);
  if (value.trim() === "" || Number.isNaN(n)) return null;
  if (low != null && n < low) return "L";
  if (high != null && n > high) return "H";
  return null;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  receptionist: "Receptionist",
  clinician: "OPD Clinician",
  lab_tech: "Laboratory Technician",
};

export type Area = "dashboard" | "reception" | "opd" | "lab" | "admin" | "patients" | "results";

export const AREA_ROLES: Record<Area, AppRole[]> = {
  dashboard: ["admin", "receptionist", "clinician", "lab_tech"],
  patients: ["admin", "receptionist", "clinician", "lab_tech"],
  reception: ["admin", "receptionist"],
  opd: ["admin", "clinician"],
  lab: ["admin", "lab_tech"],
  results: ["admin", "clinician", "lab_tech"],
  admin: ["admin"],
};

export function canAccess(roles: AppRole[], area: Area) {
  return roles.some((r) => AREA_ROLES[area].includes(r));
}

export function ageFromDob(dob: string | null, now = new Date(), estimated = false): string | null {
  if (!dob) return null;
  if (estimated) return `~${ageFromDob(dob, now)}`;
  const d = new Date(dob);
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  if (age < 1) {
    const months =
      (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
    return `${Math.max(months, 0)} mo`;
  }
  return `${age} yr`;
}
