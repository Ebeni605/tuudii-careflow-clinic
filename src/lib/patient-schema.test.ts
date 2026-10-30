import { describe, expect, it } from "vitest";
import { EMPTY_PATIENT, clinicToday, friendlyDbError, patientSchema, toPatientRow } from "./patient-schema";

const base = { ...EMPTY_PATIENT, first_name: "Demo", middle_name: "Abebe", sex: "female" as const, date_of_birth: "1990-01-01" };
const errorsOf = (v: object) => {
  const r = patientSchema.safeParse(v);
  return r.success ? {} : r.error.flatten().fieldErrors;
};

describe("patient registration rules", () => {
  it("requires first name, father's name and sex; grandfather's name is optional", () => {
    expect(errorsOf(base)).toEqual({});
    expect(errorsOf({ ...base, middle_name: " " }).middle_name?.[0]).toBe("Father's name is required");
    expect(errorsOf({ ...base, first_name: "" }).first_name?.[0]).toBe("First name is required");
    expect(errorsOf({ ...base, sex: "" }).sex?.[0]).toBe("Select sex");
  });

  it("needs a date of birth or an estimated age", () => {
    expect(errorsOf({ ...base, date_of_birth: "" }).date_of_birth).toBeTruthy();
    expect(errorsOf({ ...base, dob_mode: "estimated", estimated_age: "" }).estimated_age).toBeTruthy();
    expect(errorsOf({ ...base, dob_mode: "estimated", estimated_age: "40", estimated_age_unit: "years" })).toEqual({});
    expect(errorsOf({ ...base, date_of_birth: "2999-01-01" }).date_of_birth?.[0]).toBe("Date of birth cannot be in the future");
  });

  it("requires a guardian for children under 15", () => {
    const child = { ...base, dob_mode: "estimated", estimated_age: "6", estimated_age_unit: "months" };
    expect(errorsOf(child).guardian_name).toBeTruthy();
    expect(errorsOf({ ...child, guardian_name: "Demo Guardian" })).toEqual({});
  });

  it("accepts Ethiopian phone formats and rejects junk", () => {
    expect(errorsOf({ ...base, phone: "0911 234 567" })).toEqual({});
    expect(errorsOf({ ...base, phone: "+251911234567" })).toEqual({});
    expect(errorsOf({ ...base, phone: "12ab" }).phone).toBeTruthy();
  });

  it("sends an estimated age instead of a date of birth when the DOB is unknown", () => {
    const row = toPatientRow({ ...base, dob_mode: "estimated", estimated_age: "3", estimated_age_unit: "years", phone: "0911-234-567" });
    expect(row.dob_estimated).toBe(true);
    expect(row.date_of_birth).toBeNull();
    expect(row.estimated_age).toBe(3);
    expect(row.phone).toBe("0911234567");
  });

  it("uses Ethiopia's date for 'today'", () => {
    // 22:30 UTC on 1 Jan is already 2 Jan in Addis Ababa (UTC+3)
    expect(clinicToday(new Date("2026-01-01T22:30:00Z"))).toBe("2026-01-02");
  });

  it("explains duplicate queue entries in plain words", () => {
    expect(friendlyDbError('duplicate key value violates unique constraint "visits_one_active_per_patient_day"')).toBe("This patient is already in today's queue.");
  });
});
