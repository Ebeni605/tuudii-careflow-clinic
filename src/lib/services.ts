/**
 * Reception service choice.
 *
 * The clinic advertises ten services. "Minor Surgery and Male Circumcision for Infants" is one
 * advertised service but two clinical procedures in the database (`minor_surgery`,
 * `infant_circumcision`) so each keeps its own OPD form and signing rules (consent / guardian
 * consent). Reception picks the advertised service, then the procedure.
 */
export type ServiceRow = { key: string; name: string; display_order?: number };

export const OTHER_SERVICE_KEY = "general_followup";
export const SERVICE_DETAIL_MAX = 200;

export const SERVICE_GROUPS = [
  {
    value: "group:surgery",
    label: "Minor Surgery and Male Circumcision for Infants",
    keys: ["minor_surgery", "infant_circumcision"],
    procedureLabels: { minor_surgery: "Minor surgery", infant_circumcision: "Male circumcision for an infant" } as Record<string, string>,
  },
] as const;

export type ServiceOption = { value: string; label: string; group?: (typeof SERVICE_GROUPS)[number] };

/** The options shown in the Select Clinic Service dropdown, in catalogue order (grouped procedures appear once). */
export function serviceOptions(services: ServiceRow[]): ServiceOption[] {
  const out: ServiceOption[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    const g = SERVICE_GROUPS.find((x) => (x.keys as readonly string[]).includes(s.key));
    if (g) {
      if (!seen.has(g.value)) { seen.add(g.value); out.push({ value: g.value, label: g.label, group: g }); }
    } else out.push({ value: s.key, label: s.name });
  }
  return out;
}

/** Which dropdown option a saved service key belongs to. */
export function optionValueFor(key: string): string {
  return SERVICE_GROUPS.find((g) => (g.keys as readonly string[]).includes(key))?.value ?? key;
}

export function groupOf(value: string) {
  return SERVICE_GROUPS.find((g) => g.value === value || (g.keys as readonly string[]).includes(value));
}

/** Problem with the reception service choice, or null when it can be saved. */
export function serviceChoiceProblem(key: string, detail: string): string | null {
  if (!key) return "Select the clinic service";
  if (key.startsWith("group:")) return "Choose the procedure (minor surgery or infant circumcision)";
  if (detail.trim().length > SERVICE_DETAIL_MAX) return `Service details must be ${SERVICE_DETAIL_MAX} characters or fewer`;
  return null;
}

/** Details are only kept for the "other services" choice. */
export function serviceDetailFor(key: string, detail: string): string | null {
  return key === OTHER_SERVICE_KEY && detail.trim() ? detail.trim() : null;
}

/** Display text for a saved service, e.g. in the OPD queue. */
export function serviceLabel(services: ServiceRow[] | undefined, key: string, detail?: string | null): string {
  const g = groupOf(key);
  const name = g ? `${g.label} — ${g.procedureLabels[key] ?? key}` : services?.find((s) => s.key === key)?.name ?? key;
  return detail ? `${name}: ${detail}` : name;
}
