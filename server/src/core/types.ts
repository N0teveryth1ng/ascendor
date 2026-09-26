/**
 * THE FORGE v2 — domain types.
 * Mirrors Section 10 (DATA MODEL) and the revision tables in Sections 2-5.
 */

export type CandidateId = string;

/* ── Section 1.3: Personalized Calibration Profile ─────────────────────────── */

export type VocabularyBand = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12';
export type SyntaxCeiling = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';
export type Rank = 'RANK 00: MASTER' | 'RANK 01: STRIKER' | 'RANK 02: OPERATOR' | 'RANK 03: DECODER';

export interface Phase1EntryDifficultySeed {
  /** APE starting latency threshold in ms, derived from C1/C2/C5. */
  latency_threshold_ms: number;
  /** APE starting speed multiplier for audio stimulus, derived from C3. */
  speed_multiplier: number;
  /** Streaming WPM ceiling from C3 max intelligible WPM, minus headroom. */
  wpm_ceiling: number;
  /** Flash duration for visuo-spatial stimuli, ms. Range clamp 1200-2500 per §7.1.2. */
  flash_duration_ms: number;
  /** Starting phase sub-level for each Phase 1 module (1-based). */
  phase1_sublevel: Record<Phase1ModuleId, number>;
}

export interface Pcp {
  candidate_id: CandidateId;
  calibration_date: string;
  vocabulary_band: VocabularyBand;
  syntax_ceiling: SyntaxCeiling;
  baseline_reflex_latency_ms: number;
  baseline_vocal_clarity: number;
  typo_vulnerability_index: number;
  flagged_weak_vectors: string[];
  entry_rank: Rank;
  phase_1_entry_difficulty_seed: Phase1EntryDifficultySeed;
  /** Raw calibration traces, retained for auditability. */
  vectors: CalibrationVectorResult[];
  locked: boolean;
}

export type CalibrationVectorId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5';

export interface CalibrationVectorResult {
  vector: CalibrationVectorId;
  /** Untimed-first pass: the actual capability ceiling. */
  untimed: { accuracy_pct: number; errors: number; total: number };
  /** Timed-second pass: how much speed degrades that ceiling. */
  timed: { accuracy_pct: number; mean_latency_ms: number; threshold_ms: number };
  /** Vector-specific numeric output. */
  readout: Record<string, number | string>;
  completed_at: string;
}

/* ── Metrics (Section 3) ───────────────────────────────────────────────────── */

export interface Metrics {
  precision_index: number;
  reflex_latency_pct_of_baseline: number;
  retention_density: number;
  vocal_clarity_delta: number;
  pattern_intuition: number;
}

export interface MetricFloors {
  /** Baseline stats are immutable downward. See Section 5.2 and Section 8. */
  precision_index: number;
  reflex_latency_pct_of_baseline: number;
  retention_density: number;
  vocal_clarity_delta: number;
  pattern_intuition: number;
}

export interface MetricProvenance {
  /** true while RD is derived from same-session recall only (no 24h data yet). */
  rd_provisional: boolean;
  /** Sessions included in each metric's derivation. */
  sessions_in_rl_window: number;
  updated_at: string;
}

/* ── Modules (Sections 6, 7) ──────────────────────────────────────────────── */

export type Phase = 1 | 2 | 3 | 4;

export type Phase1ModuleId = 'P1_VD' | 'P1_VSF' | 'P1_VM';
export type Phase2ModuleId = 'P2_RDI' | 'P2_FCM';
export type Phase3ModuleId = 'P3_SSM' | 'P3_HVS';
export type Phase4ModuleId = 'P4_PC' | 'P4_VDS';
export type ModuleId = Phase1ModuleId | Phase2ModuleId | Phase3ModuleId | Phase4ModuleId;
export type BlockId = 'VOCAL' | 'VECTOR' | 'DICTATION' | 'VISUOSPATIAL' | 'LOGGING';

export interface ModuleDescriptor {
  id: ModuleId;
  phase: Phase;
  title: string;
  block: BlockId;
  /** Target accuracy band [min, max]. Outside the band the APE adjusts. */
  target_band: { min_pct: number; max_pct: number };
  /** Hard clamps on the APE latency threshold, ms. Section 8 safeguard. */
  threshold_clamp_ms: { min: number; max: number };
  /** Max APE speed multiplier before the module refuses to escalate further. */
  speed_clamp: { min: number; max: number };
  /** Slot-substitution patterns drive PTI. Non-slot modules score PTI as n/a. */
  contributes_pti: boolean;
  /** Visual flash durations, ms. */
  flash_clamp_ms?: { min: number; max: number };
}

export interface RollingWindow {
  last_8_sessions: SessionSummary[];
  current_threshold_ms: number;
  speed_multiplier: number;
  adjustment_factor_log: AdjustmentLogEntry[];
  sublevel: number;
  consecutive_in_band: number;
  escalation_ready: boolean;
  /**
   * Session that consumed the last escalation. Section 2.4 requires three NEW
   * consecutive in-band sessions between sublevels; without this marker the
   * same three sessions would re-trigger on every subsequent session.
   */
  last_escalated_session_id: string | null;
}

export interface AdjustmentLogEntry {
  session_id: string;
  recorded_at: string;
  accuracy_trend_pct: number;
  latency_trend_ms: number;
  factor: number;
  reason: 'TIGHTEN' | 'HOLD' | 'LOOSEN' | 'CLAMPED' | 'INIT';
  threshold_before_ms: number;
  threshold_after_ms: number;
  clamp_applied: 'NONE' | 'MIN' | 'MAX' | 'MIN_SPEED' | 'MAX_SPEED';
}

export interface SessionSummary {
  session_id: string;
  started_at: string;
  module_id: ModuleId;
  sublevel: number;
  accuracy_pct: number;
  mean_latency_ms: number;
  /** Error tags observed this session. Drives Structural Lock recurrence. */
  errors: string[];
}

/* ── Errors (Section 4) ────────────────────────────────────────────────────── */

export type ErrorTagCode =
  | 'ACCEPTED'
  | 'LATENCY_FAIL'
  | 'PATTERN_MISMATCH'
  | 'TYPO_DETECTED'
  | 'STRUCTURAL_LOCK_TRIGGERED'
  | 'STREAK_TERMINATED';

export interface ErrorEvent {
  code: ErrorTagCode;
  /** Sub-category, e.g. tense_marker, their_there, consonant_clusters_str_thr. */
  category: string | null;
  input: string | null;
  expected: string | null;
  /** Char position for TYPO_DETECTED. */
  position: number | null;
  /** Delta over threshold for LATENCY_FAIL. */
  delta_ms: number | null;
  /** Rendered exactly as Section 4.2 specifies. One line, no prose. */
  rendered: string;
}

export interface Attempt {
  item_id: string;
  item_kind: string;
  correct: boolean;
  input: string | null;
  expected: string | null;
  latency_ms: number;
  error_code: ErrorTagCode;
  error_category: string | null;
  char_position: number | null;
  latency_delta_ms: number | null;
  counted_chars: number;
  correct_chars: number;
  /** Slot-substitution items only; drives PTI. */
  slot_category?: string | null;
  /** Marked when the item is a 24h delayed recall re-presentation. */
  delayed_recall?: boolean;
  /** VC phoneme match score, 0-100. Vocal items only. */
  clarity_score?: number | null;
}

/* ── Structural Locks (Section 2.3) ───────────────────────────────────────── */

export interface StructuralLock {
  tag: string;
  module_id: ModuleId;
  sessions_flagged: number;
  remediation_active: boolean;
  triggered_at: string;
  sessions_remaining: number;
  /** Diverted share of next N sessions (15% per Section 2.3). */
  diversion_pct: number;
  cleared_at: string | null;
  /** Progress does not stall while this is active (Section 2.3). */
  blocks_escalation: boolean;
}

/* ── Ranks (Section 5) ─────────────────────────────────────────────────────── */

export interface RankGateResult {
  rank: Rank;
  satisfied: boolean;
  requirements: { label: string; met: boolean; detail: string }[];
}

/* ── Sessions & daily protocol (Sections 5.2, 6) ──────────────────────────── */

export interface BlockAllocation {
  block: BlockId;
  title: string;
  start_s: number;
  end_s: number;
  duration_s: number;
  /** ±5 min adjustment from active Structural Locks (Section 6). */
  adjustment_s: number;
  adjustment_reason: string | null;
}

export interface DailySchedule {
  date: string;
  total_s: number;
  blocks: BlockAllocation[];
  forced_repeat_modules: ModuleId[];
  notes: string[];
}

export interface SessionResultInput {
  session_id: string;
  candidate_id: CandidateId;
  module_id: ModuleId;
  attempts: Attempt[];
  started_at: string;
  ended_at: string;
  block_id?: BlockId;
  /** Delayed-recall presentation of a prior session's item set. */
  delayed_recall_of?: string | null;
}

export interface SessionResult {
  session_id: string;
  module_id: ModuleId;
  accuracy_pct: number;
  mean_latency_ms: number;
  threshold_ms: number;
  speed_multiplier: number;
  adjustment: AdjustmentLogEntry;
  structural_locks_triggered: string[];
  structural_locks_cleared: string[];
  escalation_ready: boolean;
  sublevel: number;
  rank_change: { from: Rank; to: Rank } | null;
  /** Per-day verdict produced by this session. Section 5.2. */
  daily_tier: DailyTierOutcome;
  grade_log: ErrorEvent[];
}

export interface DailyTierOutcome {
  date: string;
  aggregate_pct: number;
  tier: FailureTier;
  streak_before: number;
  streak_after: number;
  multiplier_after: number;
  modules_failed: ModuleId[];
  forced_repeat: boolean;
  /** Structural, by design: failing never removes access. */
  lockout_applied: false;
  /** Structural, by design: baseline statistics are append-only. */
  baseline_stats_cut: false;
}

/* ── Streaks & failure tiers (Section 5.2) ────────────────────────────────── */

export interface Streak {
  current: number;
  multiplier: number;
  last_date: string | null;
  best: number;
}

export type FailureTier = 'NONE' | 'BELOW_95' | 'BELOW_85';

export interface DailyLogEntry {
  date: string;
  aggregate_pct: number;
  tier: FailureTier;
  streak_before: number;
  streak_after: number;
  multiplier_after: number;
  modules_failed: ModuleId[];
  forced_repeat: boolean;
  /**
   * Section 5.2: baseline stats are NEVER cut and access is NEVER revoked.
   * Recorded for audit only. Typed as `boolean` (not the literal `false`) so the
   * column stays readable from SQLite without the DTO lying about its shape.
   */
  baseline_stats_cut: boolean;
  lockout_applied: boolean;
}

/* ── Full profile (Section 10) ────────────────────────────────────────────── */

export interface CandidateProfile {
  candidate_id: CandidateId;
  display_name: string;
  created_at: string;
  pcp: Pcp | null;
  current_rank: Rank;
  metrics: Metrics;
  metric_floors: MetricFloors;
  metric_provenance: MetricProvenance;
  active_structural_locks: StructuralLock[];
  rolling_windows: Record<string, RollingWindow>;
  streak: Streak;
  daily_log: DailyLogEntry[];
  rank_history: { rank: Rank; at: string }[];
  pending_remediation: ModuleId[];
  phase_unlocked: Record<Phase, boolean>;
  master_window: { days: number; sessions: number; accuracy_pct: number; qualifies: boolean };
}
