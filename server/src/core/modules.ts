import type { ModuleDescriptor, ModuleId, Phase, Rank } from './types.js';

/**
 * Rank ordering, weakest first. MASTER is the terminal rank.
 */
export const RANK_ORDER: Rank[] = [
  'RANK 03: DECODER',
  'RANK 02: OPERATOR',
  'RANK 01: STRIKER',
  'RANK 00: MASTER',
];

export function rankIndex(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

/**
 * RANK_ORDER is weakest-first, so a HIGHER index is a STRONGER rank.
 * "At least OPERATOR" is therefore rankIndex(rank) >= rankIndex(required).
 */
export function rankAtLeast(rank: Rank, required: Rank): boolean {
  return rankIndex(rank) >= rankIndex(required);
}

/**
 * Module registry. Target bands and clamps encode Section 7's requirements:
 * APE-adjustable ranges with hard bounds so the engine cannot tune itself
 * into impossibility (Section 8).
 */
export const MODULES: Record<ModuleId, ModuleDescriptor> = {
  P1_VD: {
    id: 'P1_VD',
    phase: 1,
    title: 'VECTOR DISAMBIGUATION',
    block: 'VECTOR',
    target_band: { min_pct: 95, max_pct: 100 },
    threshold_clamp_ms: { min: 900, max: 4000 },
    speed_clamp: { min: 0.7, max: 1.8 },
    contributes_pti: true,
  },
  P1_VSF: {
    id: 'P1_VSF',
    phase: 1,
    title: 'VISUO-SPATIAL FLASH',
    block: 'VISUOSPATIAL',
    target_band: { min_pct: 88, max_pct: 100 },
    threshold_clamp_ms: { min: 2500, max: 12000 },
    speed_clamp: { min: 0.6, max: 1.6 },
    contributes_pti: false,
    flash_clamp_ms: { min: 1200, max: 2500 },
  },
  P1_VM: {
    id: 'P1_VM',
    phase: 1,
    title: 'VOCAL MECHANICS',
    block: 'VOCAL',
    target_band: { min_pct: 90, max_pct: 100 },
    threshold_clamp_ms: { min: 1500, max: 5000 },
    speed_clamp: { min: 0.7, max: 1.7 },
    contributes_pti: false,
  },
  P2_RDI: {
    id: 'P2_RDI',
    phase: 2,
    title: 'RAPID DICTATION INTERCEPT',
    block: 'DICTATION',
    target_band: { min_pct: 92, max_pct: 100 },
    threshold_clamp_ms: { min: 700, max: 3500 },
    speed_clamp: { min: 0.8, max: 2.0 },
    contributes_pti: false,
  },
  P2_FCM: {
    id: 'P2_FCM',
    phase: 2,
    title: 'FLOWCHART COMPREHENSION MAPPING',
    block: 'VISUOSPATIAL',
    target_band: { min_pct: 88, max_pct: 100 },
    threshold_clamp_ms: { min: 2000, max: 10000 },
    speed_clamp: { min: 0.6, max: 1.5 },
    contributes_pti: false,
    flash_clamp_ms: { min: 6000, max: 14000 },
  },
  P3_SSM: {
    id: 'P3_SSM',
    phase: 3,
    title: 'SLOT-SUBSTITUTION MATRIX',
    block: 'VECTOR',
    target_band: { min_pct: 95, max_pct: 100 },
    threshold_clamp_ms: { min: 800, max: 4500 },
    speed_clamp: { min: 0.6, max: 1.6 },
    contributes_pti: true,
  },
  P3_HVS: {
    id: 'P3_HVS',
    phase: 3,
    title: 'HIGH-VELOCITY STREAM PROCESSING',
    block: 'DICTATION',
    target_band: { min_pct: 92, max_pct: 100 },
    threshold_clamp_ms: { min: 700, max: 4000 },
    speed_clamp: { min: 0.7, max: 2.2 },
    contributes_pti: false,
  },
  P4_PC: {
    id: 'P4_PC',
    phase: 4,
    title: 'THE PRESSURE CHAMBER',
    block: 'DICTATION',
    target_band: { min_pct: 96, max_pct: 100 },
    threshold_clamp_ms: { min: 600, max: 3000 },
    speed_clamp: { min: 0.8, max: 1.9 },
    contributes_pti: false,
  },
  P4_VDS: {
    id: 'P4_VDS',
    phase: 4,
    title: 'VOCAL DEXTERITY STRESS RUN',
    block: 'VOCAL',
    target_band: { min_pct: 92, max_pct: 100 },
    threshold_clamp_ms: { min: 1200, max: 4500 },
    speed_clamp: { min: 0.7, max: 1.6 },
    contributes_pti: false,
  },
};

export const ALL_MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export function modulesInPhase(phase: Phase): ModuleId[] {
  return ALL_MODULE_IDS.filter((id) => MODULES[id].phase === phase);
}

/**
 * Section 7 gating: Phase 2 unlocks at OPERATOR, Phase 3 unlocks at
 * OPERATOR, Phase 4 unlocks at STRIKER.
 */
export const PHASE_UNLOCK_RANK: Record<Phase, Rank | null> = {
  1: null,
  2: 'RANK 02: OPERATOR',
  3: 'RANK 02: OPERATOR',
  4: 'RANK 01: STRIKER',
};

/**
 * Section 6 default allocation. APE weighting shifts time between blocks
 * (Section 6) but the shell stays rigid.
 */
export const BASE_BLOCK_MINUTES: { block: ModuleDescriptor['block']; title: string; minutes: number }[] = [
  { block: 'VOCAL', title: 'VOCAL MECHANICS', minutes: 5 },
  { block: 'VECTOR', title: 'VECTOR DISAMBIGUATION', minutes: 10 },
  { block: 'DICTATION', title: 'SPEED DICTATION', minutes: 15 },
  { block: 'VISUOSPATIAL', title: 'VISUO-SPATIAL RECONSTRUCTION', minutes: 12 },
  { block: 'LOGGING', title: 'METRIC LOGGING + APE RECALCULATION', minutes: 3 },
];
