export interface ReadingDay { date: string; seconds: number }
export interface PhoneReadingStats {
  totalBooks: number;
  totalSeconds: number;
  longestStreak: number;
  avgDailySeconds: number;
  week: ReadingDay[];
  activity: ReadingDay[];
}
interface StatsInput { bookKeys: string[]; daily: unknown; totals: unknown; progress: unknown; deleted: string[] }
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const seconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : 0;
export const readingDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const shiftReadingDate = (date: Date, offset: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
export function parseReadingDate(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return readingDateKey(date) === key ? date : null;
}

export function phoneReadingStats(input: StatsInput, today = new Date()): PhoneReadingStats {
  const todayKey = readingDateKey(today), byDate = new Map<string, number>(), byBook = new Map<string, number>();
  for (const [date, entries] of Object.entries(record(input.daily))) {
    if (!parseReadingDate(date) || date > todayKey || !Array.isArray(entries)) continue;
    const dayBooks = new Map<string, number>();
    for (const entry of entries) {
      if (typeof entry !== "string") continue;
      const match = /^(.*)-(\d+(?:\.\d+)?)$/.exec(entry);
      if (!match?.[1]) continue;
      const value = seconds(Number(match[2]));
      // Each persisted entry is the cumulative counter for one book/day.
      dayBooks.set(match[1], Math.max(dayBooks.get(match[1]) || 0, value));
    }
    let daySeconds = 0;
    for (const [book, value] of dayBooks) { daySeconds += value; byBook.set(book, (byBook.get(book) || 0) + value); }
    byDate.set(date, daySeconds);
  }
  const datedSeconds = Array.from(byDate.values()).reduce((sum, value) => sum + value, 0);
  for (const [book, value] of Object.entries(record(input.totals))) byBook.set(book, Math.max(byBook.get(book) || 0, seconds(value)));
  const progress = record(input.progress), deleted = new Set(input.deleted);
  const totalBooks = new Set(input.bookKeys.filter(key => !deleted.has(key) && ((byBook.get(key) || 0) > 0 || Object.keys(record(progress[key])).length > 0))).size;
  const activeDates = Array.from(byDate).filter(([, value]) => value > 0).map(([date]) => date).sort();
  let longestStreak = 0, streak = 0, previous = "";
  for (const date of activeDates) {
    streak = previous && readingDateKey(shiftReadingDate(parseReadingDate(previous)!, 1)) === date ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak); previous = date;
  }
  const days = (count: number): ReadingDay[] => Array.from({ length: count }, (_, index) => {
    const date = readingDateKey(shiftReadingDate(today, index - count + 1));
    return { date, seconds: byDate.get(date) || 0 };
  });
  return { totalBooks, totalSeconds: Array.from(byBook.values()).reduce((sum, value) => sum + value, 0), longestStreak,
    avgDailySeconds: activeDates.length ? Math.round(datedSeconds / activeDates.length) : 0, week: days(7), activity: days(90) };
}
