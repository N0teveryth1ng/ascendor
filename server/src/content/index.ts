import type {
  CandidateId,
  ModuleId,
  Pcp,
  RollingWindow,
  StructuralLock,
  VocabularyBand,
} from '../core/types.js';
import { MODULES } from '../core/modules.js';
import { REMEDIATION_DIVERSION_PCT, REMEDIATION_SPEED_RELIEF } from '../core/ape.js';
import { seededRng, type Rng } from '../core/prng.js';
import { BAND_ORDER, VOCAB_BANDS } from './vocab.js';
import { SYNTAX_TASKS, SYNTAX_LEVELS, type SyntaxTask } from './syntax.js';
import { patternItemsForBand, slotItemsForBand, type PatternItem, type SlotItem } from './patterns.js';
import { expectedActionText, scenesForBand, type Scene } from './scenes.js';
import { dictationItemsForBand, type DictationItem } from './dictation.js';
import { MICROTEXTS, streamsForBand, type MicroText, type StreamItem } from './comprehension.js';
import {
  activeHesitationTargets,
  BURST_GROUPS,
  DEFAULT_BURST_ORDER,
  FLAG_PHONEME_MAP,
  passagesForTier,
} from './vocal.js';
import type { ErrorCategory } from '../core/errorTags.js';

/* ── Item types ───────────────────────────────────────────────────────────── */

interface ItemBase {
  item_id: string;
  /** APE latency threshold for this item, ms. Never changes mid-session. */
  threshold_ms: number;
  /** True when the item is part of Structural Lock remediation. */
  remediation: boolean;
}

export type DrillItem =
  | (ItemBase & {
      kind: 'pattern';
      pair: [string, string];
      marker: string;
      prompt: string;
      options: string[];
      expected: string;
      distractor: string;
      category: ErrorCategory;
      mode: 'pattern';
    })
  | (ItemBase & {
      kind: 'syntax';
      level: string;
      construction: string;
      scaffold: string;
      options: string[];
      expected: string;
      category: ErrorCategory;
      mode: 'pattern';
    })
  | (ItemBase & {
      kind: 'scene';
      title: string;
      flash_duration_ms: number;
      slot_count: number;
      slots: { slot: number; expected: string; distractors: string[] }[];
      category: ErrorCategory;
      mode: 'pattern';
      delayed_recall: boolean;
      scene_id: string;
    })
  | (ItemBase & {
      kind: 'burst';
      group: string;
      group_label: string;
      token: string;
      repetitions: number;
      category: ErrorCategory;
      mode: 'pattern';
    })
  | (ItemBase & {
      kind: 'read_aloud';
      passage_id: string;
      title: string;
      text: string;
      hesitation_targets: string[];
      category: ErrorCategory;
      mode: 'pattern';
    })
  | (ItemBase & {
      kind: 'dictation';
      text: string;
      trap_category: ErrorCategory | null;
      mode: 'typo' | 'pattern';
      category: ErrorCategory;
    })
  | (ItemBase & {
      kind: 'microtext';
      title: string;
      sentences: string[];
      display_ms: number;
      steps: { index: number; text: string; node: string }[];
      blank_index: number;
      options: string[];
      expected: string;
      category: ErrorCategory;
      mode: 'pattern';
    })
  | (ItemBase & {
      kind: 'slot';
      frame_a: string;
      swapped_condition: string;
      expected: string;
      distractor: string;
      slot_category: string;
      swap_interval_ms: number;
      category: ErrorCategory;
      mode: 'pattern';
    })
  | (ItemBase & {
      kind: 'stream';
      tokens: string[];
      wpm: number;
      anomaly_window_ms: number;
      anomaly_index: number;
      anomaly_token: string;
      expected: string;
      category: ErrorCategory;
      mode: 'pattern' | 'typo';
    })
  | (ItemBase & {
      kind: 'pressure';
      stream_tokens: string[];
      dictation_text: string;
      visual_cue: string;
      wpm: number;
      response_window_ms: number;
      window_reduction_pct: number;
      category: ErrorCategory;
      mode: 'pattern' | 'typo';
    });

export interface SessionPlan {
  session_id: string;
  candidate_id: CandidateId;
  module_id: ModuleId;
  module_title: string;
  sublevel: number;
  threshold_ms: number;
  speed_multiplier: number;
  /** APE-adjusted parameters for this module. Held fixed for the whole block. */
  params: {
    flash_duration_ms: number | null;
    display_ms: number | null;
    swap_interval_ms: number | null;
    wpm: number | null;
    anomaly_window_ms: number | null;
    response_window_ms: number | null;
  };
  remediation: { tag: string; item_ids: string[]; speed_relief: number } | null;
  items: DrillItem[];
  /** Items excluded from pass/fail because their phoneme class is still locked. */
  excluded_from_scoring: string[];
  target_band: { min_pct: number; max_pct: number };
}

export interface BuildSessionInput {
  candidate_id: CandidateId;
  pcp: Pcp;
  window: RollingWindow;
  locks: StructuralLock[];
  session_index: number;
  /** Pre-built delayed-recall scene payload, if this session repeats one. */
  delayed_scene?: DelayedScenePayload | null | undefined;
}

export interface DelayedScenePayload {
  scene_id: string;
  slots: { slot: number; expected: string }[];
}

/* ── Item counts ──────────────────────────────────────────────────────────── */

const BASE_ITEMS = 12;
const ITEMS_PER_SUBLEVEL = 2;
const MAX_ITEMS = 24;

function itemCount(sublevel: number): number {
  return Math.min(MAX_ITEMS, BASE_ITEMS + (sublevel - 1) * ITEMS_PER_SUBLEVEL);
}

/* ── Builder ──────────────────────────────────────────────────────────────── */

export function buildSession(moduleId: ModuleId, input: BuildSessionInput): SessionPlan {
  const descriptor = MODULES[moduleId];
  const rng = seededRng(input.candidate_id, moduleId, input.session_index);
  const n = itemCount(input.window.sublevel);

  const band: VocabularyBand = input.pcp.vocabulary_band;
  const activeLock = input.locks.find((l) => l.module_id === moduleId && l.remediation_active) ?? null;
  const relief = activeLock ? REMEDIATION_SPEED_RELIEF : 1;
  // Remediation runs at reduced speed: threshold widens by the relief factor.
  const threshold = round2(input.window.current_threshold_ms * relief);
  const speed = round3(input.window.speed_multiplier / relief);

  const params: SessionPlan['params'] = {
    flash_duration_ms: null,
    display_ms: null,
    swap_interval_ms: null,
    wpm: null,
    anomaly_window_ms: null,
    response_window_ms: null,
  };

  let items: DrillItem[] = [];
  let excluded: string[] = [];

  switch (moduleId) {
    case 'P1_VD': {
      const pool = patternItemsForBand(band, BAND_ORDER);
      items = buildPatternItems(pool, n, rng, threshold);
      break;
    }
    case 'P1_VSF': {
      const scenes = scenesForBand(band, BAND_ORDER);
      params.flash_duration_ms = flashFor(input.window, descriptor.flash_clamp_ms);
      items = buildSceneItems(scenes, n, rng, threshold, params.flash_duration_ms, input.delayed_scene ?? null);
      break;
    }
    case 'P1_VM': {
      const lockedClasses = lockPhonemeClasses(input.locks, input.pcp);
      const groups = burstGroupsFor(input.pcp, lockedClasses);
      const passages = passagesForTier(1, band, BAND_ORDER);
      const built: DrillItem[] = [];
      for (const g of groups) {
        for (let i = 0; i < 3; i++) {
          const tokens = BURST_GROUPS[g]!.tokens;
          const token = tokens[(rng.int(0, tokens.length) + i) % tokens.length] as string;
          built.push({
            item_id: `P1_VM-${g}-${i}`,
            kind: 'burst',
            threshold_ms: threshold,
            remediation: false,
            group: g,
            group_label: BURST_GROUPS[g]!.label,
            token,
            repetitions: 3 + input.window.sublevel,
            category: (FLAG_PHONEME_MAP[flagForClass(g)] ?? 'phoneme_substitution') as ErrorCategory,
            mode: 'pattern',
          });
        }
      }
      for (const p of passages) {
        built.push({
          item_id: `P1_VM-${p.id}`,
          kind: 'read_aloud',
          threshold_ms: threshold,
          remediation: false,
          passage_id: p.id,
          title: p.title,
          text: p.text,
          hesitation_targets: p.hesitation_targets.filter((t) => !lockedClasses.includes(t)),
          category: 'clarity_deficit',
          mode: 'pattern',
        });
        excluded.push(...p.hesitation_targets.filter((t) => lockedClasses.includes(t)).map((t) => `${p.id}:${t}`));
      }
      items = built.slice(0, n + 4);
      break;
    }
    case 'P2_RDI': {
      const pool = dictationItemsForBand(band, BAND_ORDER);
      items = buildDictationItems(pool, n, rng, threshold);
      break;
    }
    case 'P2_FCM': {
      const pool = MICROTEXTS.filter((m) => BAND_ORDER.indexOf(m.min_band) <= BAND_ORDER.indexOf(band));
      params.display_ms = displayFor(input.window, descriptor.flash_clamp_ms);
      items = buildMicrotextItems(pool, n, rng, threshold, params.display_ms);
      break;
    }
    case 'P3_SSM': {
      const pool = slotItemsForBand(band, BAND_ORDER);
      params.swap_interval_ms = swapFor(input.window);
      items = buildSlotItems(pool, n, rng, threshold, params.swap_interval_ms);
      break;
    }
    case 'P3_HVS': {
      const pool = streamsForBand(band, BAND_ORDER);
      params.wpm = streamWpm(input.pcp, input.window);
      params.anomaly_window_ms = anomalyWindowFor(input.window);
      items = buildStreamItems(pool, n, rng, threshold, params.wpm, params.anomaly_window_ms);
      break;
    }
    case 'P4_PC': {
      const dictPool = dictationItemsForBand(band, BAND_ORDER);
      const streamPool = streamsForBand(band, BAND_ORDER);
      const scenePool = scenesForBand(band, BAND_ORDER);
      params.wpm = streamWpm(input.pcp, input.window);
      params.response_window_ms = round2(threshold * 0.9);
      items = buildPressureItems(dictPool, streamPool, scenePool, n, rng, threshold, params.wpm, params.response_window_ms);
      break;
    }
    case 'P4_VDS': {
      const lockedClasses = lockPhonemeClasses(input.locks, input.pcp);
      const passages = passagesForTier(2, band, BAND_ORDER);
      const active = activeHesitationTargets(passages, lockedClasses);
      const built: DrillItem[] = passages.map((p) => ({
        item_id: `P4_VDS-${p.id}`,
        kind: 'read_aloud' as const,
        threshold_ms: threshold,
        remediation: false,
        passage_id: p.id,
        title: p.title,
        text: p.text,
        hesitation_targets: active,
        category: 'hesitation_onset' as ErrorCategory,
        mode: 'pattern' as const,
      }));
      excluded.push(
        ...passages.flatMap((p) => p.hesitation_targets.filter((t) => lockedClasses.includes(t)).map((t) => `${p.id}:${t}`)),
      );
      items = built;
      break;
    }
  }

  // 2.3: divert ~15% of the session to isolated drilling of the locked pattern.
  if (activeLock && items.length > 0) {
    const divertCount = Math.max(2, Math.round(items.length * (REMEDIATION_DIVERSION_PCT / 100)));
    const matching = items.filter((it) => itemCategory(it) === activeLock.tag);
    const chosen = matching.length > 0
      ? rng.sample(matching, Math.min(divertCount, matching.length))
      : rng.sample(items, Math.min(divertCount, items.length));
    const chosenIds = new Set(chosen.map((c) => c.item_id));
    items = [
      ...chosen.map((c) => ({ ...c, remediation: true })),
      ...items.filter((i) => !chosenIds.has(i.item_id)),
    ];
  }

  return {
    session_id: `S-${input.candidate_id}-${moduleId}-${input.session_index}`,
    candidate_id: input.candidate_id,
    module_id: moduleId,
    module_title: descriptor.title,
    sublevel: input.window.sublevel,
    threshold_ms: threshold,
    speed_multiplier: speed,
    params,
    remediation: activeLock
      ? { tag: activeLock.tag, item_ids: items.filter((i) => i.remediation).map((i) => i.item_id), speed_relief: relief }
      : null,
    items,
    excluded_from_scoring: [...new Set(excluded)],
    target_band: descriptor.target_band,
  };
}

function itemCategory(i: DrillItem): string | null {
  if (i.kind === 'slot') return i.slot_category;
  return i.category;
}

/* ── Per-module APE-adjustable parameters (Section 7) ─────────────────────── */

/**
 * APE adjustment factor `f` scales a *time budget* directly and a *rate*
 * inversely. TIGHTEN is f=0.93, so deadlines shrink and delivery rates rise.
 * These two helpers keep that distinction in one place; mixing the direction
 * up is a silent pacing bug, so nothing below multiplies or divides by hand.
 */
function timeBudget(base: number, f: number): number {
  return base * f;
}

function deliveryRate(seed: number, f: number): number {
  return seed / f;
}

/** Most recent APE factor, defaulting to 1.00 (HOLD) before any adjustment. */
function lastFactor(window: RollingWindow): number {
  const last = window.adjustment_factor_log[window.adjustment_factor_log.length - 1];
  return last ? last.factor : 1;
}

function flashFor(window: RollingWindow, clamp: { min: number; max: number } | undefined): number {
  const base = 2000;
  if (!clamp) return base;
  // TIGHTEN => shorter flash.
  return Math.round(clampOf(timeBudget(base, lastFactor(window)), clamp.min, clamp.max));
}

function displayFor(window: RollingWindow, clamp: { min: number; max: number } | undefined): number {
  const base = 8000;
  if (!clamp) return base;
  return Math.round(clampOf(timeBudget(base, lastFactor(window)), clamp.min, clamp.max));
}

function swapFor(window: RollingWindow): number {
  // Starts 1.5s, tightens only on sustained accuracy per Section 2.2.
  return Math.round(clampOf(timeBudget(1500, lastFactor(window)), 600, 3000));
}

function streamWpm(pcp: Pcp, window: RollingWindow): number {
  // A rate, not a duration: TIGHTEN must raise delivered WPM, never lower it.
  const seed = pcp.phase_1_entry_difficulty_seed.wpm_ceiling;
  return Math.round(clampOf(deliveryRate(seed, lastFactor(window)), 90, 420));
}

function anomalyWindowFor(window: RollingWindow): number {
  // Starts 3s, APE-adjustable.
  return Math.round(clampOf(timeBudget(3000, lastFactor(window)), 1200, 9000));
}

function clampOf(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/* ── Phoneme lock plumbing ────────────────────────────────────────────────── */

function lockPhonemeClasses(locks: StructuralLock[], pcp: Pcp): string[] {
  const classes = new Set<string>();
  for (const l of locks) {
    if (!l.remediation_active) continue;
    if (l.module_id === 'P1_VM' || l.module_id === 'P4_VDS') {
      const mapped = FLAG_PHONEME_MAP[l.tag] ?? l.tag;
      classes.add(mapped);
    }
  }
  for (const f of pcp.flagged_weak_vectors) {
    const mapped = FLAG_PHONEME_MAP[f];
    if (mapped && (f.startsWith('consonant') || f in FLAG_PHONEME_MAP)) classes.add(mapped);
  }
  return [...classes];
}

function flagForClass(phonemeClass: string): string {
  for (const [flag, cls] of Object.entries(FLAG_PHONEME_MAP)) {
    if (cls === phonemeClass) return flag;
  }
  return 'phoneme_substitution';
}

/**
 * Calibration's C4 vector flags the phonemes to drill. If C4 flagged nothing
 * specific, drill the default burst set rather than guessing.
 */
function burstGroupsFor(pcp: Pcp, lockedClasses: string[]): string[] {
  const flagged = pcp.flagged_weak_vectors
    .map((f) => FLAG_PHONEME_MAP[f])
    .filter((c): c is string => typeof c === 'string' && c in BURST_GROUPS);
  const base = flagged.length ? flagged : DEFAULT_BURST_ORDER;
  const open = base.filter((c) => !lockedClasses.includes(c));
  return open.length ? open : base;
}

/* ── Item assembly ────────────────────────────────────────────────────────── */

function base(id: string, threshold: number): ItemBase {
  return { item_id: id, threshold_ms: threshold, remediation: false };
}

function buildPatternItems(
  pool: PatternItem[],
  n: number,
  rng: Rng,
  threshold: number,
): DrillItem[] {
  const chosen = takeRepeatable(pool, n, rng, (p) => `${p.expected}|${p.marker}`);
  return chosen.map((p) => ({
    ...base(`P1_VD-${p.id}-${rng.int(1000, 9999)}`, threshold),
    kind: 'pattern' as const,
    pair: p.pair,
    marker: p.marker,
    prompt: p.prompt,
    options: rng.shuffle([p.expected, p.distractor]),
    expected: p.expected,
    distractor: p.distractor,
    category: p.category,
    mode: 'pattern' as const,
  }));
}

function buildDictationItems(
  pool: DictationItem[],
  n: number,
  rng: Rng,
  threshold: number,
): DrillItem[] {
  const chosen = takeRepeatable(pool, n, rng, (d) => d.text);
  return chosen.map((d) => ({
    ...base(`P2_RDI-${d.id}-${rng.int(1000, 9999)}`, threshold),
    kind: 'dictation' as const,
    text: d.text,
    trap_category: d.trap ? d.trap.category : 'spelling_error',
    mode: d.mode,
    category: d.trap ? d.trap.category : 'spelling_error',
  }));
}

function buildSceneItems(
  pool: Scene[],
  n: number,
  rng: Rng,
  threshold: number,
  flashMs: number,
  delayed: DelayedScenePayload | null,
): DrillItem[] {
  if (delayed) {
    const scene = pool.find((s) => s.id === delayed.scene_id) ?? pool[0];
    if (scene) {
      return [
        {
          ...base(`P1_VSF-DELAY-${scene.id}`, threshold),
          kind: 'scene',
          title: scene.title,
          flash_duration_ms: flashMs,
          slot_count: delayed.slots.length,
          slots: delayed.slots.map((s) => {
            const a = scene.actions.find((x) => x.slot === s.slot);
            return {
              slot: s.slot,
              expected: s.expected,
              distractors: a ? [a.actor, a.verb, a.object] : scene.distractors.slice(0, 3),
            };
          }),
          category: 'scene_action_binding',
          mode: 'pattern',
          delayed_recall: true,
          scene_id: scene.id,
        },
      ];
    }
  }
  const chosen = takeRepeatable(pool, Math.max(1, Math.ceil(n / 3)), rng, (s) => s.id);
  return chosen.flatMap((s) =>
    s.actions.slice(0, 3).map((a) => ({
      ...base(`P1_VSF-${s.id}-${a.slot}-${rng.int(1000, 9999)}`, threshold),
      kind: 'scene' as const,
      title: s.title,
      flash_duration_ms: flashMs,
      slot_count: s.actions.length,
      slots: [
        {
          slot: a.slot,
          expected: expectedActionText(a),
          distractors: rng.shuffle([a.actor, a.verb, a.object, a.spatial].filter((x) => x !== a.actor && x !== a.verb && x !== a.object)),
        },
      ],
      category: 'scene_action_binding' as ErrorCategory,
      mode: 'pattern' as const,
      delayed_recall: false,
      scene_id: s.id,
    })),
  );
}

function buildMicrotextItems(
  pool: MicroText[],
  n: number,
  rng: Rng,
  threshold: number,
  displayMs: number,
): DrillItem[] {
  const chosen = takeRepeatable(pool, n, rng, (m) => m.id);
  return chosen.map((m) => ({
    ...base(`P2_FCM-${m.id}-${rng.int(1000, 9999)}`, threshold),
    kind: 'microtext',
    title: m.title,
    sentences: m.sentences,
    display_ms: displayMs,
    steps: m.steps,
    blank_index: m.blank_index,
    options: rng.shuffle(m.options),
    expected: m.expected,
    category: m.category,
    mode: 'pattern',
  }));
}

function buildSlotItems(
  pool: SlotItem[],
  n: number,
  rng: Rng,
  threshold: number,
  swapIntervalMs: number,
): DrillItem[] {
  const chosen = takeRepeatable(pool, n, rng, (s) => s.swappedCondition);
  return chosen.map((s) => ({
    ...base(`P3_SSM-${s.id}-${rng.int(1000, 9999)}`, threshold),
    kind: 'slot',
    frame_a: s.frameA,
    swapped_condition: s.swappedCondition,
    expected: s.expected,
    distractor: s.distractor,
    slot_category: s.category,
    swap_interval_ms: swapIntervalMs,
    category: s.category,
    mode: 'pattern',
  }));
}

function buildStreamItems(
  pool: StreamItem[],
  n: number,
  rng: Rng,
  threshold: number,
  wpm: number,
  windowMs: number,
): DrillItem[] {
  const chosen = takeRepeatable(pool, n, rng, (s) => s.id);
  return chosen.map((s) => ({
    ...base(`P3_HVS-${s.id}-${rng.int(1000, 9999)}`, threshold),
    kind: 'stream',
    tokens: s.tokens,
    wpm,
    anomaly_window_ms: windowMs,
    anomaly_index: s.anomaly_index,
    anomaly_token: s.anomaly_token,
    expected: s.corrected,
    category: s.category,
    mode: 'pattern',
  }));
}

function buildPressureItems(
  dictPool: DictationItem[],
  streamPool: StreamItem[],
  scenePool: Scene[],
  n: number,
  rng: Rng,
  threshold: number,
  wpm: number,
  responseWindowMs: number,
): DrillItem[] {
  const dict = takeRepeatable(dictPool, Math.ceil(n / 2), rng, (d) => d.text);
  const streams = takeRepeatable(streamPool, Math.floor(n / 3), rng, (s) => s.id);
  const scenes = takeRepeatable(scenePool, 1, rng, (s) => s.id);
  const items: DrillItem[] = [];
  for (const d of dict) {
    items.push({
      ...base(`P4_PC-D-${d.id}-${rng.int(1000, 9999)}`, threshold),
      kind: 'pressure',
      stream_tokens: [],
      dictation_text: d.text,
      visual_cue: '',
      wpm,
      response_window_ms: responseWindowMs,
      window_reduction_pct: 0,
      category: d.trap ? d.trap.category : 'clarity_deficit',
      mode: d.mode,
    });
  }
  for (const s of streams) {
    items.push({
      ...base(`P4_PC-S-${s.id}-${rng.int(1000, 9999)}`, threshold),
      kind: 'pressure',
      stream_tokens: s.tokens,
      dictation_text: '',
      visual_cue: s.anomaly_token,
      wpm,
      response_window_ms: responseWindowMs,
      window_reduction_pct: 0,
      category: s.category,
      mode: 'pattern',
    });
  }
  for (const sc of scenes) {
    items.push({
      ...base(`P4_PC-V-${sc.id}-${rng.int(1000, 9999)}`, threshold),
      kind: 'pressure',
      stream_tokens: [],
      dictation_text: '',
      visual_cue: sc.actions.map((a) => `${a.actor} ${a.verb} ${a.object}`).join(' | '),
      wpm,
      response_window_ms: responseWindowMs,
      window_reduction_pct: 0,
      category: 'scene_action_binding',
      mode: 'pattern',
    });
  }
  return items;
}

/**
 * Draws exactly `count` items, cycling the pool with fresh shuffles so a long
 * session never repeats a stimulus back-to-back. If the pool is smaller than
 * the requested count it is reused — the session length is never silently
 * shortened.
 */
function takeRepeatable<T>(pool: T[], count: number, rng: Rng, key: (t: T) => string): T[] {
  if (pool.length === 0) return [];
  const out: T[] = [];
  let seen = new Set<string>();
  let previousKey: string | null = null;
  let guard = 0;
  while (out.length < count && guard < count * 12) {
    for (const p of rng.shuffle(pool)) {
      const k = key(p);
      if (seen.has(k)) continue;
      if (k === previousKey) continue;
      seen.add(k);
      previousKey = k;
      out.push(p);
      if (out.length >= count) break;
    }
    // Pool exhausted: release the seen-set so the next pass may reuse it.
    if (seen.size >= pool.length) seen = new Set();
    guard++;
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export { SYNTAX_TASKS, SYNTAX_LEVELS };
export type { SyntaxTask };
