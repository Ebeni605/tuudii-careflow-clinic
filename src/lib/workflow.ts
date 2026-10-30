// Shared clinical workflow rules. The database triggers enforce the same rules;
// this module drives which buttons the UI shows.

export type AppRole = "admin" | "receptionist" | "clinician" | "lab_tech";

export type VisitStatus =
  | "waiting"
  | "in_consultation"
  | "awaiting_lab"
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
  awaiting_lab: ["in_consultation", "completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

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

export function ageFromDob(dob: string | null, now = new Date(), estimated = false) {
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
