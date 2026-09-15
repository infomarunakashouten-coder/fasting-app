import { HEALTH_TIMEZONE } from "./schema";

export type DateResolution =
  | { status: "resolved"; date: string }
  | { status: "ambiguous"; date: null }
  | { status: "invalid"; date: null };

const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: HEALTH_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getTokyoReference(now = new Date()) {
  return {
    referenceDate: formatTokyoDate(now),
    referenceDateTime: now.toISOString(),
    timezone: HEALTH_TIMEZONE,
  } as const;
}
export function formatTokyoDate(date: Date): string {
  const parts = DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("REFERENCE_DATE_UNAVAILABLE");
  }

  return `${year}-${month}-${day}`;
}

export function addCalendarDays(date: string, amount: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed) {
    throw new Error("INVALID_REFERENCE_DATE");
  }
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount));
  return [
    shifted.getUTCFullYear().toString().padStart(4, "0"),
    (shifted.getUTCMonth() + 1).toString().padStart(2, "0"),
    shifted.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export function resolveHealthDate(
  expression: string | null,
  referenceDate: string,
): DateResolution {
  const normalized = expression?.trim().replace(/\s+/g, "") ?? "";

  if (!normalized || normalized === "今日") {
    return { status: "resolved", date: referenceDate };
  }
  if (normalized === "昨日") {
    return { status: "resolved", date: addCalendarDays(referenceDate, -1) };
  }
  if (normalized === "一昨日") {
    return { status: "resolved", date: addCalendarDays(referenceDate, -2) };
  }

  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const japaneseMatch = normalized.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  const match = isoMatch ?? japaneseMatch;
  if (match) {
    const date = toValidIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return date
      ? { status: "resolved", date }
      : { status: "invalid", date: null };
  }

  if (/^\d{1,2}月\d{1,2}日$/.test(normalized)) {
    return { status: "ambiguous", date: null };
  }

  return { status: "ambiguous", date: null };
}

function parseIsoDate(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return toValidIsoDate(year, month, day) ? { year, month, day } : null;
}

function toValidIsoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
