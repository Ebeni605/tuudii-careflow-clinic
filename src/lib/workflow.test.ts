import { describe, expect, it } from "vitest";
import { abnormalFlag, canAccess, canLabMove, canVerify, canVisitMove, isResultVisibleToClinician } from "./workflow";

describe("clinic workflow rules", () => {
  it("lab results go requested → collected → processing → resulted → verified only", () => {
    expect(canLabMove("requested", "collected")).toBe(true);
    expect(canLabMove("requested", "verified")).toBe(false);
    expect(canLabMove("processing", "resulted")).toBe(true);
    expect(canLabMove("resulted", "verified")).toBe(true);
    expect(canLabMove("verified", "processing")).toBe(false);
  });

  it("the technician who entered a result cannot verify it unless allowed to self-verify", () => {
    expect(canVerify({ resultedBy: "a", userId: "a", canSelfVerify: false })).toBe(false);
    expect(canVerify({ resultedBy: "a", userId: "b", canSelfVerify: false })).toBe(true);
    expect(canVerify({ resultedBy: "a", userId: "a", canSelfVerify: true })).toBe(true);
  });

  it("clinicians see a result only after verification", () => {
    expect(isResultVisibleToClinician("resulted")).toBe(false);
    expect(isResultVisibleToClinician("verified")).toBe(true);
  });

  it("a completed visit cannot be reopened", () => {
    expect(canVisitMove("waiting", "in_consultation")).toBe(true);
    expect(canVisitMove("completed", "waiting")).toBe(false);
  });

  it("each role reaches only its own department", () => {
    expect(canAccess(["receptionist"], "opd")).toBe(false);
    expect(canAccess(["receptionist"], "reception")).toBe(true);
    expect(canAccess(["clinician"], "lab")).toBe(false);
    expect(canAccess(["lab_tech"], "lab")).toBe(true);
    expect(canAccess(["lab_tech"], "admin")).toBe(false);
    expect(canAccess(["admin"], "admin")).toBe(true);
  });

  it("flags numeric results outside the reference range", () => {
    expect(abnormalFlag("9", 12, 17)).toBe("L");
    expect(abnormalFlag("18", 12, 17)).toBe("H");
    expect(abnormalFlag("14", 12, 17)).toBe(null);
    expect(abnormalFlag("Negative", null, null)).toBe(null);
  });
});
