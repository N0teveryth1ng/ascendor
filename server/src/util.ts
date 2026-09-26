export function nowIso(): string {
  return new Date().toISOString();
}

export function todayUtc(dateStr?: string): string {
  if (dateStr) return dateStr;
  // Local calendar date; the daily protocol is the candidate's day, not UTC's.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The local calendar day before `dateStr` (defaults to today). */
export function previousDay(dateStr?: string): string {
  const [y, m, d] = todayUtc(dateStr).split('-').map(Number);
  const prev = new Date(Date.UTC(y!, m! - 1, d!));
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
