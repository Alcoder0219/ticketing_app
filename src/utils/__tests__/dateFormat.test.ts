import { describe, it, expect } from "vitest";
import {
  formatDate,
  getAppYMD,
  getAppTodayStr,
  getAppDateStrDaysAgo,
  zonedDayRangeUtc,
  getAppCalendarDayDiff,
  APP_TIMEZONE,
} from "../dateFormat";

describe("Africa/Nairobi timezone utility", () => {
  it("uses the correct IANA identifier", () => {
    expect(APP_TIMEZONE).toBe("Africa/Nairobi");
  });

  it("converts a normal UTC timestamp to Nairobi (UTC 07:35 -> Nairobi 10:35)", () => {
    expect(formatDate("2026-09-09T07:35:00.000Z", true)).toBe("09-09-2026, 10:35");
  });

  it("handles the midnight-boundary case (UTC 21:30 on the 8th -> Nairobi 00:30 on the 9th)", () => {
    expect(formatDate("2026-09-08T21:30:00.000Z", true)).toBe("09-09-2026, 00:30");
    const ymd = getAppYMD("2026-09-08T21:30:00.000Z")!;
    expect(ymd).toEqual({ year: 2026, month: 9, day: 9 });
  });

  it("date-only format ignores the time component", () => {
    expect(formatDate("2026-09-08T21:30:00.000Z", false)).toBe("09-09-2026");
  });

  it("returns an em dash for missing/invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("zonedDayRangeUtc: a picked calendar day maps to Nairobi 00:00:00.000 - 23:59:59.999", () => {
    // A Date built with local Y/M/D components, as a <Calendar> picker would produce.
    const picked = new Date(2026, 8, 9); // 9 Sep 2026, local midnight
    const { start, end } = zonedDayRangeUtc(picked);
    expect(start.toISOString()).toBe("2026-09-08T21:00:00.000Z"); // Nairobi midnight = UTC-3h
    expect(end.toISOString()).toBe("2026-09-09T20:59:59.999Z");
  });

  it("getAppTodayStr / getAppDateStrDaysAgo return YYYY-MM-DD in Nairobi", () => {
    expect(getAppTodayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getAppDateStrDaysAgo(15)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getAppCalendarDayDiff counts whole Nairobi calendar days, not 24h chunks", () => {
    // 21:30 UTC on the 8th is already the 9th in Nairobi; one real day later
    // (21:30 UTC on the 9th) is the 10th in Nairobi -> a 1-day calendar diff.
    expect(getAppCalendarDayDiff("2026-09-09T21:30:00.000Z", "2026-09-08T21:30:00.000Z")).toBe(1);
    expect(getAppCalendarDayDiff("2026-09-09T00:00:00.000Z", "2026-09-09T00:00:00.000Z")).toBe(0);
  });
});
