/**
 * Deterministic PRNG. Sessions must be reproducible for a given
 * (candidate, module, session index) so a rebuilt drill is identical and
 * item sets never silently duplicate within a window.
 */

export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  sample<T>(arr: readonly T[], count: number): T[];
  bool(probability: number): boolean;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min));
  return {
    next,
    int,
    pick: <T,>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('Rng.pick on empty array');
      return arr[int(0, arr.length)] as T;
    },
    shuffle: <T,>(arr: readonly T[]): T[] => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i + 1);
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    sample: <T,>(arr: readonly T[], count: number): T[] => {
      const n = Math.min(count, arr.length);
      return shuffleWith(next, arr).slice(0, n);
    },
    bool: (probability: number): boolean => next() < probability,
  };
}

function shuffleWith<T>(next: () => number, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export function seededRng(...parts: (string | number)[]): Rng {
  return mulberry32(hashString(parts.join('|')));
}
