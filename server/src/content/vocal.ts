import type { VocabularyBand } from '../core/types.js';

/* ── C4 / 7.1.3 Vocal Mechanics / 7.4.2 Vocal Dexterity ───────────────────── */

export interface VocalPassage {
  id: string;
  min_band: VocabularyBand;
  tier: 1 | 2;
  title: string;
  text: string;
  /** Phoneme classes the passage is expected to exercise. */
  targets: string[];
  /** Zero-hesitation scoring applies to these phoneme classes only. */
  hesitation_targets: string[];
}

/**
 * C4 is scored for clarity, not accent. It flags physical mechanics issues
 * (consonant clusters, specific phoneme substitutions) against the
 * candidate's own VC0 baseline — never against a native-speaker ideal.
 */
export const VOCAL_PASSAGES: VocalPassage[] = [
  {
    id: 'VP-01', min_band: 'V1', tier: 1, title: 'ARTICULATION BASELINE',
    text: 'The third string on the instrument stretches further than the others. Red leather, black thread, six strong strokes, three thick clouds.',
    targets: ['str_cluster', 'th_digraph', 'lateral', 'voiceless_stops', 'voiced_stops'],
    hesitation_targets: ['str_cluster', 'th_digraph'],
  },
  {
    id: 'VP-02', min_band: 'V1', tier: 1, title: 'CLUSTER PRACTICE',
    text: 'Strong streams, strict structures, three strange streets, twelve strong streams, the strongest strictest structure.',
    targets: ['str_cluster', 'k_luster', 'tr_cluster'],
    hesitation_targets: ['str_cluster', 'tr_cluster'],
  },
  {
    id: 'VP-03', min_band: 'V2', tier: 1, title: 'PLOSIVE CONTROL',
    text: 'Peter Piper picked a peck of pickled peppers. Big black bugs bled blue blood. The tabby cat tapped the tin tub.',
    targets: ['voiceless_stops', 'voiced_stops', 'p_b_distinction', 't_d_distinction'],
    hesitation_targets: ['p_b_distinction', 't_d_distinction'],
  },
  {
    id: 'VP-04', min_band: 'V3', tier: 1, title: 'FRICATIVE AND SIBILANT',
    text: 'Six sleek shapes shifted swiftly. The thin thread thinks this fifth sheath is smooth enough for a photograph.',
    targets: ['fricatives', 'sibilants', 'voiceless_stops'],
    hesitation_targets: ['sibilants', 'fricatives'],
  },
  {
    id: 'VP-05', min_band: 'V4', tier: 1, title: 'SENTENCE FALL',
    text: 'Accuracy rose across three consecutive sessions, so the engine tightened the response window by a small margin.',
    targets: ['stress_shift', 'voiced_stops', 'nasals'],
    hesitation_targets: [],
  },
  {
    id: 'VP-06', min_band: 'V1', tier: 2, title: 'TIER 2 — CLASSIC TWISTER',
    text: 'She sells seashells by the seashore, and the shells she sells are surely seashells.',
    targets: ['sibilants', 'lateral', 'stress_shift'],
    hesitation_targets: ['sibilants', 'stress_shift'],
  },
  {
    id: 'VP-07', min_band: 'V1', tier: 2, title: 'TIER 2 — PLOSIVE TWISTER',
    text: 'Red leather, yellow leather, red leather, and a dozen bright blue badges.',
    targets: ['voiced_stops', 'voiceless_stops', 'nasals'],
    hesitation_targets: ['voiced_stops', 'voiceless_stops'],
  },
  {
    id: 'VP-08', min_band: 'V2', tier: 2, title: 'TIER 2 — CLUSTER TWISTER',
    text: 'The sixth sick sheikh sips thick strawberry shake through a straw.',
    targets: ['th_digraph', 'str_cluster', 'sh_cluster', 'lateral'],
    hesitation_targets: ['th_digraph', 'sh_cluster'],
  },
  {
    id: 'VP-09', min_band: 'V3', tier: 2, title: 'TIER 2 — SWITCH TWISTER',
    text: 'Which wristwatches are Swiss wristwatches that switch to switchable light switches?',
    targets: ['sibilants', 'w_lateral', 'voiceless_stops'],
    hesitation_targets: ['sibilants', 'w_lateral'],
  },
  {
    id: 'VP-10', min_band: 'V4', tier: 2, title: 'TIER 2 — SYSTEM VOCABULARY',
    text: 'Three strict structural streams stretched past the sixteenth threshold without a single structural stress fracture.',
    targets: ['str_cluster', 'tr_cluster', 'th_digraph', 'stress_shift'],
    hesitation_targets: ['str_cluster', 'tr_cluster', 'th_digraph'],
  },
];

/** Consonant burst targets, generated per calibration flag (7.1.3). */
export const BURST_GROUPS: Record<string, { label: string; tokens: string[] }> = {
  voiceless_stops: { label: 'P-T-K', tokens: ['pa', 'ta', 'ka', 'pta', 'tka', 'kpa', 'pta-pta', 'tka-tka', 'kpa-kpa'] },
  voiced_stops: { label: 'B-D-G', tokens: ['ba', 'da', 'ga', 'bda', 'dga', 'gba', 'bda-bda', 'dga-dga', 'gba-gba'] },
  str_cluster: { label: 'STR', tokens: ['stra', 'stri', 'stru', 'stral', 'strib', 'struc', 'stra-stra', 'stri-stri', 'stru-stru'] },
  th_digraph: { label: 'TH', tokens: ['tha', 'thi', 'tho', 'thab', 'thid', 'thoc', 'tha-tha', 'thi-thi', 'tho-tho'] },
  fricatives: { label: 'F-V', tokens: ['fa', 'vi', 'fu', 'fav', 'vif', 'fuv', 'fa-fa', 'vi-vi', 'fu-fu'] },
  sibilants: { label: 'S-Z-SH', tokens: ['sa', 'za', 'sha', 'saz', 'zash', 'shas', 'sa-sa', 'za-za', 'sha-sha'] },
  nasals: { label: 'M-N', tokens: ['ma', 'na', 'man', 'nam', 'nan', 'mam', 'ma-ma', 'na-na', 'man-man'] },
  laterals: { label: 'L', tokens: ['la', 'li', 'lu', 'lal', 'lil', 'lul', 'la-la', 'li-li', 'lu-lu'] },
  p_b_distinction: { label: 'P-B', tokens: ['pa', 'ba', 'pab', 'bap', 'paba', 'bapa', 'pa-pa', 'ba-ba', 'pab-bap'] },
  t_d_distinction: { label: 'T-D', tokens: ['ta', 'da', 'tad', 'dat', 'tada', 'data', 'ta-ta', 'da-da', 'tad-dat'] },
  stress_shift: { label: 'STRESS', tokens: ['INspect', 'inSECT', 'REcord', 'reCORD', 'preSENT', 'preSENT'] },
  tr_cluster: { label: 'TR', tokens: ['tra', 'tri', 'tru', 'tral', 'trib', 'truc', 'tra-tra', 'tri-tri', 'tru-tru'] },
  k_luster: { label: 'KL', tokens: ['kla', 'kli', 'klu', 'klal', 'klil', 'klul', 'kla-kla', 'kli-kli', 'klu-klu'] },
  sh_cluster: { label: 'SH', tokens: ['sha', 'shi', 'shu', 'shal', 'shib', 'shuc', 'sha-sha', 'shi-shi', 'shu-shu'] },
  w_lateral: { label: 'W', tokens: ['wa', 'wi', 'wu', 'wal', 'wib', 'wuc', 'wa-wa', 'wi-wi', 'wu-wu'] },
};

/** Default burst order when Calibration C4 flags nothing specific. */
export const DEFAULT_BURST_ORDER = ['voiceless_stops', 'voiced_stops', 'str_cluster', 'th_digraph'];

/** Phoneme classes named by the C4 calibration flag strings. */
export const FLAG_PHONEME_MAP: Record<string, string> = {
  consonant_clusters_str_thr: 'str_cluster',
  th_digraph: 'th_digraph',
  fricative_control: 'fricatives',
  sibilant_control: 'sibilants',
  plosive_control: 'voiceless_stops',
  nasal_control: 'nasals',
  lateral_control: 'laterals',
  stress_placement: 'stress_shift',
};

export function passagesForTier(tier: 1 | 2, band: VocabularyBand, allBands: VocabularyBand[]): VocalPassage[] {
  const cap = allBands.indexOf(band);
  return VOCAL_PASSAGES.filter((p) => p.tier === tier && allBands.indexOf(p.min_band) <= cap);
}

/**
 * 7.4.2: the zero-hesitation standard applies only to phonemes already
 * cleared out of Structural Lock. Phonemes still under active remediation
 * are excluded from this module's pass/fail scoring.
 */
export function activeHesitationTargets(
  passages: VocalPassage[],
  lockedPhonemeClasses: string[],
): string[] {
  const all = new Set(passages.flatMap((p) => p.hesitation_targets));
  for (const c of lockedPhonemeClasses) all.delete(c);
  return [...all].sort();
}
