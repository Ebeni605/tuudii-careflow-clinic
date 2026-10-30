import { describe, expect, it } from "vitest";
import { canLabMove, canVerify, isLabFinal, labResultFlag, labValueProblem, referenceText, type LabTestConfig } from "./workflow";

const numeric: LabTestConfig = { name: "Hgb", result_type: "numeric", ref_low: 12, ref_high: 17, result_options: null, abnormal_options: null };
const unconfigured: LabTestConfig = { ...numeric, ref_low: null, ref_high: null };
const hbsag: LabTestConfig = { name: "HBsAg", result_type: "qualitative", ref_low: null, ref_high: null, result_options: ["Negative", "Positive"], abnormal_options: ["Positive"] };
const micro: LabTestConfig = { name: "Stool Examination", result_type: "microscopy", ref_low: null, ref_high: null, result_options: null, abnormal_options: null };

describe("Phase 4 laboratory rules", () => {
  it("only staff with explicit verification permission can verify", () => {
    expect(canVerify({ enteredBy: "a", userId: "b", canVerifyLab: false, canSelfVerify: false })).toBe(false);
    expect(canVerify({ enteredBy: "a", userId: "b", canVerifyLab: false, canSelfVerify: true })).toBe(false);
    expect(canVerify({ enteredBy: null, userId: "b", canVerifyLab: true, canSelfVerify: false })).toBe(false);
  });

  it("entering a result never verifies it: entered must be submitted, then verified", () => {
    expect(canLabMove("processing", "verified")).toBe(false);
    expect(canLabMove("entered", "verified")).toBe(false);
    expect(canLabMove("entered", "awaiting_verification")).toBe(true);
  });

  it("verified results change only through a correction back to entered", () => {
    expect(canLabMove("verified", "entered")).toBe(true);
    expect(canLabMove("verified", "awaiting_verification")).toBe(false);
    expect(canLabMove("verified", "cancelled")).toBe(false);
  });

  it("a rejected specimen waits for recollection; only verified or cancelled tests are finished", () => {
    expect(canLabMove("received", "rejected")).toBe(true);
    expect(canLabMove("rejected", "collected")).toBe(true);
    expect(isLabFinal("rejected")).toBe(false);
    expect(isLabFinal("verified")).toBe(true);
    expect(isLabFinal("cancelled")).toBe(true);
    expect(canLabMove("cancelled", "requested")).toBe(false);
  });

  it("numeric results must be numbers; L/H only from a configured range", () => {
    expect(labValueProblem(numeric, "abc")).toMatch(/needs a number/);
    expect(labValueProblem(numeric, "<0.5")).toBe(null);
    expect(labResultFlag(numeric, "9")).toBe("L");
    expect(labResultFlag(numeric, "18")).toBe("H");
    expect(labResultFlag(numeric, "14")).toBe(null);
    expect(labResultFlag(numeric, "<0.5")).toBe(null);
    expect(labResultFlag(unconfigured, "999")).toBe(null);
  });

  it("qualitative answers must be one of the configured options; abnormal answers are flagged A", () => {
    expect(labValueProblem(hbsag, "Weak")).toMatch(/Choose one of/);
    expect(labResultFlag(hbsag, "Positive")).toBe("A");
    expect(labResultFlag(hbsag, "Negative")).toBe(null);
  });

  it("microscopy/text findings are flagged only when the technician marks them", () => {
    expect(labValueProblem(micro, "No ova or parasites seen")).toBe(null);
    expect(labResultFlag(micro, "Ascaris ova seen")).toBe(null);
    expect(labResultFlag(micro, "Ascaris ova seen", true)).toBe("A");
  });

  it("an unconfigured reference shows nothing rather than an invented range", () => {
    expect(referenceText({ ref_low: null, ref_high: null, ref_text: null })).toBe("");
    expect(referenceText({ ref_low: 12, ref_high: 17, ref_text: null, unit: "g/dL" })).toBe("12 – 17 g/dL");
  });
});
