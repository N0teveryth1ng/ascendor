/** Section 9: numbers are always shown to 2 decimal places. */
export function n2(v: number): string {
  return v.toFixed(2);
}

export function pct(v: number): string {
  return `${v.toFixed(2)}%`;
}

export function ms(v: number): string {
  return `${Math.round(v)}ms`;
}

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

export function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}
