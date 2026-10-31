import { describe, expect, it } from "vitest";
import { addDays, csvCell, defaultRange, fmtMinutes, rangeProblem, toCsv } from "./reports";
import { invoiceState, paymentProblem, priceProblem } from "./billing";
import { canAccess } from "./workflow";

describe("CSV export", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell('Hb, "low"')).toBe('"Hb, ""low"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5")).toBe("-5");
  });
  it("writes a header row and one row per record", () => {
    const csv = toCsv([{ a: 1, b: "x" }, { a: 2, b: null }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]);
    expect(csv).toBe("A,B\r\n1,x\r\n2,");
  });
});

describe("report date ranges", () => {
  it("defaults to the last 30 clinic days", () => {
    expect(defaultRange("2026-10-30")).toEqual({ from: "2026-10-01", to: "2026-10-30" });
  });
  it("rejects a start after the end", () => {
    expect(rangeProblem("2026-10-02", "2026-10-01")).not.toBeNull();
  });
  it("limits a range to two years", () => {
    expect(rangeProblem("2024-01-01", "2026-06-01")).toBe("Date range is limited to two years");
    expect(rangeProblem("2025-10-01", "2026-10-01")).toBeNull();
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("formats turnaround minutes", () => {
    expect(fmtMinutes(45)).toBe("45 min");
    expect(fmtMinutes(125)).toBe("2 h 05 min");
    expect(fmtMinutes(null)).toBe("—");
  });
});

describe("billing rules", () => {
  it("only administrators and reception may use billing", () => {
    expect(canAccess(["receptionist"], "billing")).toBe(true);
    expect(canAccess(["administrator"], "billing")).toBe(true);
    expect(canAccess(["opd_clinician"], "billing")).toBe(false);
    expect(canAccess(["laboratory_technician"], "billing")).toBe(false);
  });
  it("shows invoice state from status and balance", () => {
    expect(invoiceState("draft", 100, 100)).toBe("draft");
    expect(invoiceState("issued", 100, 100)).toBe("unpaid");
    expect(invoiceState("issued", 100, 40)).toBe("partly_paid");
    expect(invoiceState("issued", 100, 0)).toBe("paid");
    expect(invoiceState("void", 100, 100)).toBe("void");
  });
  it("blocks payments above the balance or of zero", () => {
    expect(paymentProblem(150, 100)).not.toBeNull();
    expect(paymentProblem(0, 100)).not.toBeNull();
    expect(paymentProblem(100, 100)).toBeNull();
  });
  it("accepts a zero price but not a negative one", () => {
    expect(priceProblem(0)).toBeNull();
    expect(priceProblem(-1)).not.toBeNull();
  });
});

import { idleRemainingMs, IDLE_MINUTES, passwordProblem } from "./session";

describe("staff password rule", () => {
  it("rejects passwords shorter than 10 characters", () => {
    expect(passwordProblem("abc12345")).toMatch(/10 characters/);
  });
  it("requires both letters and numbers", () => {
    expect(passwordProblem("onlyletterspass")).toMatch(/letters and numbers/);
    expect(passwordProblem("1234567890")).toMatch(/letters and numbers/);
  });
  it("rejects a password containing the email name", () => {
    expect(passwordProblem("almaz2026clinic", "almaz@clinic.test")).toMatch(/email/);
  });
  it("accepts a 10+ character mix of letters and numbers", () => {
    expect(passwordProblem("Clinic2026ok")).toBeNull();
  });
});

describe("idle sign-out", () => {
  it("signs out after 30 minutes without activity", () => {
    expect(IDLE_MINUTES).toBe(30);
    const last = 1_000_000;
    expect(idleRemainingMs(last, last + 29 * 60_000)).toBeGreaterThan(0);
    expect(idleRemainingMs(last, last + 30 * 60_000)).toBeLessThanOrEqual(0);
  });
});
