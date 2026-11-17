/** Random UUID that also works outside a secure context (plain-HTTP LAN dev). */
export function uid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Dates are stored as local calendar days ("YYYY-MM-DD"), never as instants,
// so "expires Tuesday" means Tuesday wherever the phone is.
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toISODate(new Date());
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from today to `iso` (negative = in the past). */
export function daysUntil(iso: string, from = today()): number {
  return Math.round((parseISODate(iso).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const short = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const long = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function relativeDay(iso: string): string {
  const n = daysUntil(iso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1 && n < 7) return weekday.format(parseISODate(iso));
  if (n < 0 && n > -7) return `${-n} days ago`;
  const d = parseISODate(iso);
  return d.getFullYear() === new Date().getFullYear() ? short.format(d) : long.format(d);
}

export type ExpiryLevel = "expired" | "urgent" | "soon" | "ok" | "none";

export function expiryLevel(iso: string | null): ExpiryLevel {
  if (!iso) return "none";
  const n = daysUntil(iso);
  if (n < 0) return "expired";
  if (n <= 2) return "urgent";
  if (n <= 7) return "soon";
  return "ok";
}

export function formatQty(q: number | null, unit: string): string {
  if (q == null) return unit;
  const n = Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
  if (!unit) return n;
  return /^[a-z]{1,2}$/.test(unit) ? `${n}${unit}` : `${n} ${unit}`;
}

/** Sensible step for the +/− buttons: 1 for counts, bigger for grams/millilitres. */
export function qtyStep(unit: string, q: number): number {
  if (unit === "g" || unit === "ml") return q >= 1000 ? 250 : 100;
  if (unit === "kg" || unit === "l") return 0.5;
  return 1;
}

export function relativeTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
