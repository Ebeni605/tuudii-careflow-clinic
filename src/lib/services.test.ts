import { describe, expect, it } from "vitest";
import { optionValueFor, serviceChoiceProblem, serviceDetailFor, serviceLabel, serviceOptions } from "./services";

const CATALOGUE = [
  { key: "internal_medicine", name: "Internal Medicine Treatment" },
  { key: "acute_chronic", name: "Acute and Chronic Disease Treatment" },
  { key: "minor_surgery", name: "Minor Surgery" },
  { key: "infant_circumcision", name: "Male Circumcision for Infants" },
  { key: "anc", name: "Antenatal Care / Pregnant Mothers Follow-up Service" },
  { key: "laboratory", name: "Comprehensive Laboratory Service" },
  { key: "family_planning", name: "Short and Long-Term Family Planning Service" },
  { key: "dental", name: "Dental Care Service" },
  { key: "diabetes", name: "Diabetes Treatment and Follow-up Service" },
  { key: "hypertension", name: "High Blood Pressure (Hypertension) Treatment" },
  { key: "general_followup", name: "Follow-up and Various Other Services" },
];

describe("reception service dropdown", () => {
  it("shows exactly the ten clinic services in order", () => {
    expect(serviceOptions(CATALOGUE).map((o) => o.label)).toEqual([
      "Internal Medicine Treatment",
      "Acute and Chronic Disease Treatment",
      "Minor Surgery and Male Circumcision for Infants",
      "Antenatal Care / Pregnant Mothers Follow-up Service",
      "Comprehensive Laboratory Service",
      "Short and Long-Term Family Planning Service",
      "Dental Care Service",
      "Diabetes Treatment and Follow-up Service",
      "High Blood Pressure (Hypertension) Treatment",
      "Follow-up and Various Other Services",
    ]);
  });

  it("needs a procedure when the surgery/circumcision service is chosen", () => {
    expect(serviceChoiceProblem("group:surgery", "")).not.toBeNull();
    expect(serviceChoiceProblem("infant_circumcision", "")).toBeNull();
    expect(optionValueFor("minor_surgery")).toBe("group:surgery");
  });

  it("requires a service and limits details to 200 characters", () => {
    expect(serviceChoiceProblem("", "")).toBe("Select the clinic service");
    expect(serviceChoiceProblem("general_followup", "x".repeat(201))).not.toBeNull();
    expect(serviceChoiceProblem("general_followup", "x".repeat(200))).toBeNull();
  });

  it("keeps details only for other services", () => {
    expect(serviceDetailFor("general_followup", "  wound dressing ")).toBe("wound dressing");
    expect(serviceDetailFor("dental", "wound dressing")).toBeNull();
    expect(serviceLabel(CATALOGUE, "general_followup", "wound dressing")).toBe("Follow-up and Various Other Services: wound dressing");
  });
});
