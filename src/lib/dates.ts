const BERLIN = "Europe/Berlin";

/** Offset of Europe/Berlin to UTC in milliseconds at the given instant. */
function berlinOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BERLIN,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Unix timestamp (seconds) of 00:00:00 on the given calendar day in Europe/Berlin. */
function berlinMidnight(year: number, month: number, day: number): number {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Invalid date: ${year}-${month}-${day}`);
  }
  let utcMs = probe.getTime() - berlinOffsetMs(probe.getTime());
  utcMs = probe.getTime() - berlinOffsetMs(utcMs); // second pass for DST transition days
  return Math.floor(utcMs / 1000);
}

export interface DateOptions {
  /** For date-only input, use the last second of the day (for inclusive end dates). */
  endOfDay?: boolean;
}

/**
 * Accepts YYYY-MM-DD, DD.MM.YYYY, a full ISO date-time or a Unix timestamp in seconds
 * and returns Unix seconds. Date-only input is interpreted in Europe/Berlin.
 */
export function toUnixTimestamp(input: string | number, options: DateOptions = {}): number {
  const value = String(input).trim();

  if (/^\d{9,11}$/.test(value)) return Number(value);

  let dayStart: number | undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (iso) dayStart = berlinMidnight(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  else if (german) dayStart = berlinMidnight(Number(german[3]), Number(german[2]), Number(german[1]));

  if (dayStart !== undefined) return options.endOfDay ? dayStart + 86_399 : dayStart;

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD, DD.MM.YYYY or a Unix timestamp.`);
  }
  return Math.floor(parsed / 1000);
}

/** DD.MM.YYYY (Europe/Berlin) - the format sevdesk's factory endpoints document for date fields. */
export function toGermanDate(input: string | number): string {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: BERLIN,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(toUnixTimestamp(input) * 1000));
  return parts;
}
