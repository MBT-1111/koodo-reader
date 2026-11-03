import { describe, expect, it } from "vitest";
import { phoneReadingStats, readingDateKey, parseReadingDate, shiftReadingDate } from "./stats";
const today = new Date(2026, 10, 3, 0, 5);
const empty = { bookKeys: [] as string[], daily: {}, totals: {}, progress: {}, deleted: [] as string[] };
describe("phone reading statistics", () => {
  it("aggregates hyphenated keys, cumulative daily counters and lifetime totals without double counting", () => {
    const input = { bookKeys: ["phone-book-a", "phone-book-b", "opened", "trash"], daily: {
      "2026-11-01": ["phone-book-a-60", "phone-book-a-120", "phone-book-b-30"],
      "2026-11-02": ["phone-book-a-60"], "2026-11-03": ["phone-book-b-90"],
    }, totals: { "phone-book-a": 180, "phone-book-b": 200, "legacy": 500 }, progress: { opened: { percentage: .1 }, trash: { percentage: .2 } }, deleted: ["trash"] };
    const before = JSON.stringify(input), result = phoneReadingStats(input, today);
    expect(result).toMatchObject({ totalBooks: 3, totalSeconds: 880, longestStreak: 3, avgDailySeconds: 100 });
    expect(result.week.slice(-3)).toEqual([{ date: "2026-11-01", seconds: 150 }, { date: "2026-11-02", seconds: 60 }, { date: "2026-11-03", seconds: 90 }]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("fills all seven and ninety local calendar days, including zero-activity days", () => {
    const result = phoneReadingStats(empty, today);
    expect(result).toMatchObject({ totalBooks: 0, totalSeconds: 0, longestStreak: 0, avgDailySeconds: 0 });
    expect(result.week).toHaveLength(7); expect(result.activity).toHaveLength(90);
    expect(result.week[0].date).toBe("2026-10-28"); expect(result.week.at(-1)?.date).toBe("2026-11-03");
    expect(result.activity.every(day => day.seconds === 0)).toBe(true);
  });
  it("computes streaks across year boundaries and leap days using all recorded history", () => {
    const daily = Object.fromEntries(["2024-02-28", "2024-02-29", "2024-03-01", "2025-12-31", "2026-01-01"].map(date => [date, ["book-10"]]));
    expect(phoneReadingStats({ ...empty, daily }, today).longestStreak).toBe(3);
    expect(parseReadingDate("2025-02-29")).toBeNull(); expect(parseReadingDate("2026-02-30")).toBeNull();
    expect(parseReadingDate("2026-13-01")).toBeNull();
  });
  it("does not treat future, malformed and zero counters as active reading days", () => {
    const result = phoneReadingStats({ ...empty, daily: {
      "2026-11-04": ["book-100"], "2026-02-30": ["book-100"], "invalid": ["book-100"],
      "2026-11-03": [null, "invalid", "book-NaN", "book-0"], "2026-11-02": false,
    }, totals: { invalid: -1, other: Infinity } }, today);
    expect(result.totalSeconds).toBe(0); expect(result.longestStreak).toBe(0); expect(result.avgDailySeconds).toBe(0);
    expect(phoneReadingStats({ ...empty, daily: null, totals: [], progress: [] }, today).totalBooks).toBe(0);
  });
  it("uses calendar dates rather than UTC slicing or fixed-length days", () => {
    expect(readingDateKey(today)).toBe("2026-11-03");
    expect(readingDateKey(shiftReadingDate(new Date(2026, 0, 1, 0, 5), -1))).toBe("2025-12-31");
    expect(readingDateKey(shiftReadingDate(new Date(2024, 1, 28, 23, 59), 1))).toBe("2024-02-29");
  });
});
