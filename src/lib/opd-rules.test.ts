import { describe, expect, it } from "vitest";
import { ancEstimates, bmi, canCompleteVisit, canVisitMove, signingProblems, validateVitals } from "./workflow";
import { SERVICE_TEMPLATES } from "./templates";

const base = { serviceKey: "internal_medicine", chiefComplaint: "Fever 3 days", treatmentNotes: "Plan written", diagnosisCount: 1, labOrderCount: 0, templateData: {} };

describe("OPD encounter rules", () => {
  it("visit statuses go Waiting → In consultation → Pending laboratory → Ready for review → Completed", () => {
    expect(canVisitMove("waiting", "in_consultation")).toBe(true);
    expect(canVisitMove("in_consultation", "awaiting_lab")).toBe(true);
    expect(canVisitMove("awaiting_lab", "ready_for_review")).toBe(true);
    expect(canVisitMove("ready_for_review", "in_consultation")).toBe(true);
    expect(canVisitMove("ready_for_review", "completed")).toBe(true);
    expect(canVisitMove("waiting", "completed")).toBe(false);
    expect(canVisitMove("completed", "in_consultation")).toBe(false);
  });

  it("a visit is completed only after its note is signed", () => {
    expect(canCompleteVisit("in_consultation", "draft")).toBe(false);
    expect(canCompleteVisit("in_consultation", null)).toBe(false);
    expect(canCompleteVisit("in_consultation", "signed")).toBe(true);
    expect(canCompleteVisit("waiting", "signed")).toBe(false);
  });

  it("signing needs a chief complaint, a diagnosis and a treatment plan", () => {
    expect(signingProblems(base)).toEqual([]);
    expect(signingProblems({ ...base, chiefComplaint: " " })).toContain("chief complaint");
    expect(signingProblems({ ...base, diagnosisCount: 0 })).toContain("at least one diagnosis");
    expect(signingProblems({ ...base, treatmentNotes: "" })).toContain("treatment / management plan");
  });

  it("a laboratory-only visit needs an indication and at least one lab order, not a diagnosis", () => {
    const lab = { ...base, serviceKey: "laboratory", diagnosisCount: 0, treatmentNotes: "" };
    expect(signingProblems(lab)).toEqual(["at least one laboratory order"]);
    expect(signingProblems({ ...lab, labOrderCount: 1 })).toEqual([]);
  });

  it("minor surgery cannot be signed without documented consent", () => {
    expect(signingProblems({ ...base, serviceKey: "minor_surgery" })).toContain("documented consent");
    expect(signingProblems({ ...base, serviceKey: "minor_surgery", templateData: { consent: true } })).toEqual([]);
  });

  it("infant circumcision needs guardian name and documented guardian consent", () => {
    const ic = { ...base, serviceKey: "infant_circumcision" };
    expect(signingProblems(ic)).toEqual(["documented guardian consent", "guardian name"]);
    expect(signingProblems({ ...ic, templateData: { guardian_consent: true, guardian_name: "Guardian Example" } })).toEqual([]);
  });

  it("all 11 clinic services have a documentation form", () => {
    expect(Object.keys(SERVICE_TEMPLATES).sort()).toEqual([
      "acute_chronic", "anc", "dental", "diabetes", "family_planning", "general_followup",
      "hypertension", "infant_circumcision", "internal_medicine", "laboratory", "minor_surgery",
    ]);
  });
});

describe("vital signs", () => {
  it("BMI is weight / height² rounded to one decimal, only with valid height and weight", () => {
    expect(bmi(70, 175)).toBe(22.9);
    expect(bmi(70, null)).toBeNull();
    expect(bmi(0, 170)).toBeNull();
    expect(bmi(70, 10)).toBeNull();
  });

  it("blood pressure needs both numbers and diastolic below systolic", () => {
    expect(validateVitals({ bp_systolic: 120 })).toContain("Enter both systolic and diastolic blood pressure");
    expect(validateVitals({ bp_systolic: 80, bp_diastolic: 90 })).toContain("Diastolic BP must be lower than systolic BP");
    expect(validateVitals({ bp_systolic: 120, bp_diastolic: 80 })).toEqual([]);
  });

  it("rejects impossible entries and empty forms", () => {
    expect(validateVitals({})).toContain("Enter at least one measurement");
    expect(validateVitals({ temperature: 375 })).toContain("Temperature must be between 30 and 45");
    expect(validateVitals({ spo2: 101 })).toContain("SpO₂ must be between 50 and 100");
    expect(validateVitals({ temperature: 37.5, pulse: 88 })).toEqual([]);
  });
});

describe("antenatal estimates", () => {
  it("EDD is LMP + 280 days and gestational age is counted from LMP", () => {
    expect(ancEstimates("2026-01-01", "2026-10-08")).toEqual({ edd: "2026-10-08", weeks: 40, days: 0 });
    expect(ancEstimates("2026-08-01", "2026-10-30")).toEqual({ edd: "2027-05-08", weeks: 12, days: 6 });
  });

  it("gives no estimate for an LMP in the future or more than 44 weeks ago", () => {
    expect(ancEstimates("2026-11-05", "2026-10-30")).toBeNull();
    expect(ancEstimates("2025-10-01", "2026-10-30")).toBeNull();
  });
});
