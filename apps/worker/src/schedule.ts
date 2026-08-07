const RESEARCH_HOURS_ET = new Set([8, 12, 16, 20]);

export interface ScheduledWindow {
  date: string;
  hour: number;
  runKey: string;
  isMorningSelection: boolean;
  maximumModelRequests: number;
}

export function getScheduledWindow(now: Date): ScheduledWindow | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.get("hour"));
  if (!RESEARCH_HOURS_ET.has(hour)) {
    return null;
  }

  const date = `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  return {
    date,
    hour,
    runKey: `research:${date}:${hour.toString().padStart(2, "0")}`,
    isMorningSelection: hour === 8,
    maximumModelRequests: hour === 8 ? 5 : hour === 20 ? 0 : 2,
  };
}

export function newYorkDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
