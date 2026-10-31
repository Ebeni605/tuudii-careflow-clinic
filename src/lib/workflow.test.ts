import { describe, expect, it } from "vitest";
import { abnormalFlag, canAccess, canLabMove, canVerify, canVisitMove, homePathFor, isResultVisibleToClinician } from "./workflow";

describe("clinic workflow rules", () => {
  it("lab tests go requested → collected → received → processing → entered → awaiting verification → verified", () => {
    expect(canLabMove("requested", "collected")).toBe(true);
    expect(canLabMove("requested", "verified")).toBe(false);
    expect(canLabMove("processing", "entered")).toBe(true);
    expect(canLabMove("entered", "verified")).toBe(false);
    expect(canLabMove("awaiting_verification", "verified")).toBe(true);
    expect(canLabMove("verified", "processing")).toBe(false);
  });

  it("the technician who entered a result cannot verify it unless allowed to self-verify", () => {
    expect(canVerify({ enteredBy: "a", userId: "a", canVerifyLab: true, canSelfVerify: false })).toBe(false);
    expect(canVerify({ enteredBy: "a", userId: "b", canVerifyLab: true, canSelfVerify: false })).toBe(true);
    expect(canVerify({ enteredBy: "a", userId: "a", canVerifyLab: true, canSelfVerify: true })).toBe(true);
  });

  it("clinicians see a result only after verification", () => {
    expect(isResultVisibleToClinician("awaiting_verification")).toBe(false);
    expect(isResultVisibleToClinician("verified")).toBe(true);
  });

  it("a completed visit cannot be reopened", () => {
    expect(canVisitMove("waiting", "in_consultation")).toBe(true);
    expect(canVisitMove("completed", "waiting")).toBe(false);
  });

  it("each role reaches only its own department", () => {
    expect(canAccess(["receptionist"], "opd")).toBe(false);
    expect(canAccess(["receptionist"], "reception")).toBe(true);
    expect(canAccess(["opd_clinician"], "lab")).toBe(false);
    expect(canAccess(["laboratory_technician"], "lab")).toBe(true);
    expect(canAccess(["laboratory_technician"], "admin")).toBe(false);
    expect(canAccess(["administrator"], "admin")).toBe(true);
    expect(canAccess(["receptionist"], "results")).toBe(false);
    expect(canAccess(["opd_clinician"], "results")).toBe(true);
    expect(canAccess([], "dashboard")).toBe(false);
  });

  it("only the administrator uses the whole-clinic dashboard", () => {
    expect(canAccess(["administrator"], "dashboard")).toBe(true);
    expect(canAccess(["receptionist"], "dashboard")).toBe(false);
    expect(canAccess(["opd_clinician"], "dashboard")).toBe(false);
    expect(canAccess(["laboratory_technician"], "dashboard")).toBe(false);
  });

  it("each role lands on its own dashboard after sign-in", () => {
    expect(homePathFor(["administrator"])).toBe("/dashboard");
    expect(homePathFor(["receptionist"])).toBe("/reception");
    expect(homePathFor(["opd_clinician"])).toBe("/opd");
    expect(homePathFor(["laboratory_technician"])).toBe("/lab");
    expect(homePathFor([])).toBe("/no-access");
  });

  it("flags numeric results outside the reference range", () => {
    expect(abnormalFlag("9", 12, 17)).toBe("L");
    expect(abnormalFlag("18", 12, 17)).toBe("H");
    expect(abnormalFlag("14", 12, 17)).toBe(null);
    expect(abnormalFlag("Negative", null, null)).toBe(null);
  });
});
