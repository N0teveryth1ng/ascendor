/* ── Wire types mirroring the server DTOs ─────────────────────────────────── */

export type Rank = 'RANK 00: MASTER' | 'RANK 01: STRIKER' | 'RANK 02: OPERATOR' | 'RANK 03: DECODER';
export type VocabularyBand = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12';
export type SyntaxCeiling = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';
export type Phase = 1 | 2 | 3 | 4;
export type Phase1ModuleId = 'P1_VD' | 'P1_VSF' | 'P1_VM';
export type Phase2ModuleId = 'P2_RDI' | 'P2_FCM';
export type Phase3ModuleId = 'P3_SWAP' | 'P3_ANOM' | 'P3_VCC';
export type Phase4ModuleId = 'P4_VDS' | 'P4_AUD' | 'P4_VOC' | 'P4_BUR';
export type ModuleId = Phase1ModuleId | Phase2ModuleId | Phase3ModuleId | Phase4ModuleId;
export type BlockId = 'VOCAL' | 'VECTOR' | 'DICTATION' | 'VISUOSPATIAL' | 'LOGGING';
export type FailureTier = 'NONE' | 'BELOW_95' | 'BELOW_85';
export type ErrorTagCode =
  | 'ACCEPTED'
  | 'LATENCY_FAIL'
  | 'PATTERN_MISMATCH'
  | 'TYPO_DETECTED'
  | 'STRUCTURAL_LOCK_TRIGGERED'
  | 'STRUCTURAL_LOCK_CLEARED'
  | 'STREAK_TERMINATED';

export interface CandidateSummary {
  candidate_id: string;
  display_name: string;
  created_at: string;
  calibrated: number | boolean;
}

export interface Pcp {
  candidate_id: string;
  calibration_date: string;
  vocabulary_band: VocabularyBand;
  syntax_ceiling: SyntaxCeiling;
  baseline_reflex_latency_ms: number;
  max_intelligible_wpm: number;
  baseline_vocal_clarity: number;
  typo_vulnerability_index: number;
  flagged_weak_vectors: string[];
  entry_rank: Rank;
  phase_1_entry_difficulty_seed: {
    latency_threshold_ms: number;
    wpm_ceiling: number;
    flash_clamp_ms: { min: number; max: number };
    phase1_sublevel: Record<string, number>;
  };
  locked: true;
}

export interface Metrics {
  precision_index: number;
  reflex_latency_pct_of_baseline: number;
  retention_density: number;
  vocal_clarity_delta: number;
  pattern_intuition: number;
}

export interface RollingWindow {
  last_8_sessions: {
    session_id: string;
    module_id: string;
    sublevel: number;
    accuracy_pct: number;
    mean_latency_ms: number;
    errors: string[];
  }[];
  current_threshold_ms: number;
  speed_multiplier: number;
  sublevel: number;
  consecutive_in_band: number;
  escalation_ready: boolean;
  last_escalated_session_id: string | null;
  adjustment_factor_log: {
    session_id: string;
    recorded_at: string;
    accuracy_trend_pct: number;
    latency_trend_ms: number;
    factor: number;
    reason: string;
    threshold_before_ms: number;
    threshold_after_ms: number;
    clamp_applied: string;
  }[];
}

export interface StructuralLock {
  id: number;
  candidate_id: string;
  module_id: string;
  tag: string;
  sessions_flagged: number;
  triggered_at: string;
  cleared_at: string | null;
  sessions_remaining: number;
  diversion_pct: number;
  blocks_escalation: boolean;
  remediation_active: boolean;
}

export interface Streak {
  current: number;
  multiplier: number;
  last_date: string | null;
  best: number;
}

export interface DailyLogEntry {
  date: string;
  aggregate_pct: number;
  tier: FailureTier;
  streak_before: number;
  streak_after: number;
  multiplier_after: number;
  modules_failed: string[];
  forced_repeat: boolean;
  baseline_stats_cut: boolean;
  lockout_applied: boolean;
}

export interface RankRequirement {
  rank: Rank;
  label: string;
  met: boolean;
  detail: string;
}

export interface CandidateProfile {
  candidate_id: string;
  display_name: string;
  created_at: string;
  pcp: Pcp;
  current_rank: Rank;
  metrics: Metrics;
  metric_floors: Metrics;
  metric_provenance: Record<string, unknown>;
  active_structural_locks: StructuralLock[];
  rolling_windows: Record<string, RollingWindow>;
  streak: Streak;
  daily_log: DailyLogEntry[];
  rank_history: { rank: Rank; at: string }[];
  pending_remediation: { module_id: string; reason: string; item_ids: string[] }[];
  phase_unlocked: Record<Phase, boolean>;
  master_window: { mean_accuracy: number; days_at_or_above_ceiling: number; sessions: number };
}

export interface BlockAllocation {
  block: string;
  title: string;
  start_s: number;
  end_s: number;
  duration_s: number;
  adjustment_s: number;
  adjustment_reason: string | null;
}

export interface DailySchedule {
  date: string;
  total_s: number;
  blocks: BlockAllocation[];
  forced_repeat_modules: string[];
  notes: string[];
}

export interface RankEvaluation {
  requirements: RankRequirement[];
  nextRank: Rank | null;
  master_stats: { mean_accuracy: number; days_at_or_above_ceiling: number; sessions: number };
}

/* ── Drill items ──────────────────────────────────────────────────────────── */

  /**
   * The error taxonomy from `ERROR_CATEGORIES` in `server/src/core/errorTags.ts`.
   * Declared here so the `DrillItem` mirror below can type `category`, and so a
   * category added on the server without a client counterpart is a build error.
   */
  export const ERROR_CATEGORIES = {
    TENSE_MARKER: 'tense_marker',
    VOICE: 'voice_agreement',
    THIRD_PERSON_S: 'third_person_s',
    ARTICLE: 'article_agreement',
    PLURAL: 'plural_agreement',
    PREPOSITION: 'preposition_selection',
    HOMOPHONE_THEIR_THERE: 'homophone_their_there',
    HOMOPHONE_THERE_THEYRE: 'homophone_there_theyre',
    HOMOPHONE_YOUR_YOURE: 'homophone_your_youre',
    HOMOPHONE_TO_TOO_TWO: 'homophone_to_too_two',
    HOMOPHONE_THEIR_THEYRE: 'homophone_their_theyre',
    LEXICAL: 'lexical_selection',
    PAST_PERFECT: 'past_perfect_construction',
    CONDITIONAL: 'conditional_construction',
    RELATIVE_CLAUSE: 'relative_clause',
    PASSIVE_VOICE: 'passive_voice',
    SLOT_IF: 'slot_if_condition',
    SLOT_THEN: 'slot_then_consequence',
    SLOT_VAR_A: 'slot_var_a',
    SLOT_VAR_B: 'slot_var_b',
    ANOMALY: 'anomaly_detection',
    SEQUENCE_ORDER: 'sequence_ordering',
    SCENE_ACTION: 'scene_action_binding',
    SCENE_OBJECT: 'scene_object_binding',
    SCENE_COUNT: 'scene_enumeration',
    PHONEME_SUBSTITUTION: 'phoneme_substitution',
    CONSONANT_CLUSTER: 'consonant_clusters_str_thr',
    CLARITY: 'clarity_deficit',
    SPELLING: 'spelling_error',
    HESITATION: 'hesitation_onset',
  } as const;
  
  export type ErrorCategory = (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES];
  
  interface ItemBase {
  item_id: string;
  threshold_ms: number;
  remediation: boolean;
}

/**
 * The drill item shape, mirroring `DrillItem` in `server/src/content/index.ts`.
 *
 * This was previously a separate hand-written union that had drifted: the server
 * emits `read_aloud`, `dictation` and `pressure`, none of which existed here,
 * and this file invented `swap`, `anomaly`, `aural` and `recall`, which the
 * server never emits. The grading code below is exhaustive over this union, so
 * a kind added on one side and not the other is now a compile error rather than
 * a silent zero score.
 *
 * Keep in lockstep with the server union. `expectedOf` in `lib/grading.ts`
 * resolves the answer key and is the only place the client learns it.
 */
export type DrillItem =
  | (ItemBase & {
      /**
       * Calibration C1. A single word from the Section 5.4 band bank plus its
       * audio cue, and nothing else. The server refuses to serve a `vocab` item
       * that is not exactly this shape.
       */
      kind: 'vocab';
      band: VocabularyBand;
      band_label: string;
      word: string;
      audio_cue: string;
      direction: 'recognition' | 'production';
      options: string[];
      expected: string;
      category: ErrorCategory;
      mode: 'pattern';
    })
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
  module_id: string;
  phase: Phase;
  sublevel: number;
  item_count: number;
  threshold_ms: number;
  speed_multiplier: number;
  params: {
    flash_duration_ms: number | null;
    display_ms: number | null;
    swap_interval_ms: number | null;
    wpm: number | null;
    anomaly_window_ms: number | null;
  };
  remediation_item_ids: string[];
  delayed_recall: { session_id: string; scene_id: string } | null;
  items: DrillItem[];
}

export interface ErrorEvent {
  code: ErrorTagCode;
  category: string | null;
  rendered: string;
  item_id?: string;
  char_position?: number | null;
  retry_ms?: number;
}

export interface Attempt {
  item_id: string;
  item_kind: string;
  input: string | null;
  expected: string | null;
  correct: boolean;
  latency_ms: number;
  error_code: ErrorTagCode | null;
  error_category: string | null;
  char_position: number | null;
  latency_delta_ms: number | null;
  counted_chars: number;
  correct_chars: number;
  slot?: number;
  sub_vector?: string;
}

export interface SessionResult {
  session_id: string;
  module_id: string;
  accuracy_pct: number;
  mean_latency_ms: number;
  threshold_ms: number;
  speed_multiplier: number;
  adjustment: { factor: number; reason: string; clamp_applied: string };
  structural_locks_triggered: string[];
  structural_locks_cleared: string[];
  escalation_ready: boolean;
  sublevel: number;
  rank_change: { from: Rank; to: Rank } | null;
  grade_log: ErrorEvent[];
  daily_tier: {
    date: string;
    aggregate_pct: number;
    tier: FailureTier;
    streak_before: number;
    streak_after: number;
    multiplier_after: number;
    modules_failed: string[];
    forced_repeat: boolean;
    lockout_applied: boolean;
    baseline_stats_cut: boolean;
  };
}

export interface CalibrationStatus {
  calibrated: boolean;
  pcp: Pcp | null;
  next_vector: string | null;
}

export interface CalibrationPass {
  vector: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  pass_type: 'untimed' | 'timed';
  correct: number;
  total: number;
  mean_latency_ms: number;
  band_accuracy?: Record<string, number>;
  level_accuracy?: Record<string, number>;
  wpm?: number;
  clarity?: number;
  /** C4: per-phoneme-class clarity. The engine reads this, not `phoneme_classes`. */
  clarity_by_class?: Record<string, number>;
  phoneme_classes?: Record<string, number>;
  typo_vulnerability_index?: number;
}

/* ── Section 13: auth, profiles, dashboards ────────────────────────────────── */

export type Role = 'candidate' | 'admin';

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar: string | null;
  role: Role;
  timezone: string;
  calibrated: boolean;
}

export interface OnboardingStep {
  key: string;
  step: number;
  title: string;
  blurb: string;
  prompt: string;
  pass_note: string;
}

export interface Onboarding {
  calibrated: boolean;
  steps: OnboardingStep[];
  manifest_version: string;
  /** Pairs already on file, so a refresh resumes instead of restarting. */
  recorded_passes?: { vector: string; pass_type: string }[];
}

export interface PracticeModule {
  id: string;
  label: string;
  phase: number;
  block: string;
  sessions: number;
  accuracy_pct: number | null;
}

export type MetricKey =
  | 'precision_index'
  | 'reflex_latency_pct_of_baseline'
  | 'retention_density'
  | 'vocal_clarity_delta'
  | 'pattern_intuition';

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendSeries {
  key: MetricKey;
  label: string;
  blurb: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  unit: string;
  points: TrendPoint[];
  current: number;
  change_pct: number | null;
}

export interface HeatmapDay {
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  pct: number;
  sessions: number;
}

export interface Heatmap {
  days: HeatmapDay[];
  current: number;
  longest: number;
}

export interface ModuleBreakdown {
  module_id: string;
  label: string;
  title: string;
  accuracy_pct: number;
  avg_response_ms: number;
  attempts: number;
  sessions: number;
}

export interface RankCard {
  current: Rank;
  next: Rank | null;
  progress_pct: number;
  requirements: { label: string; met: boolean; detail: string }[];
  next_unlocks: { rank: Rank; what: string }[];
  unlocked_modules: string[];
}

export interface TodayStatus {
  date: string;
  sessions_completed: number;
  target_sessions: number;
  block_total_s: number;
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';
  forced_repeat_modules: string[];
  active_locks: number;
  aggregate_pct: number | null;
  tier: string | null;
}

export interface Dashboard {
  calibrated: boolean;
  display_name: string;
  heatmap: Heatmap;
  trends: TrendSeries[];
  modules: ModuleBreakdown[];
  rank: RankCard;
  today: TodayStatus;
  pcp_locked: boolean;
}

export interface TeacherCandidate {
  id: string;
  display_name: string;
  email: string;
  calibrated: boolean;
  current_rank: string;
  rank_plain: string;
  streak: number;
  sessions_total: number;
  last_active: string | null;
  active_locks: number;
  weekly_accuracy: number | null;
}

export interface TeacherDetail {
  candidate: TeacherCandidate;
  dashboard: Dashboard;
  pcp: Record<string, unknown> | null;
  structural_locks: {
    key: string;
    module_id: string;
    module_plain: string;
    tag: string;
    tag_plain: string;
    sessions_flagged: number;
    sessions_remaining: number;
    diversion_pct: number;
    blocks_escalation: boolean;
    active: boolean;
    triggered_at: string;
    cleared_at: string | null;
  }[];
  error_tag_frequency: { tag: string; plain: string; count: number; last_seen: string }[];
  ape_history: {
    module_id: string;
    factor: number;
    threshold_before_ms: number;
    threshold_after_ms: number;
    recorded_at: string;
    reason: string;
  }[];
  rolling_windows: Record<string, { threshold_ms: number; speed_multiplier: number; sessions: number; mean_accuracy: number }>;
  pending_remediation: string[];
  recent_attempts: {
    exercise_id: string;
    module_id: string;
    question_shown: string;
    answer_given: string | null;
    is_correct: boolean;
    response_time_ms: number;
    error_tag: string | null;
    error_plain: string | null;
    hidden_metrics_delta: string;
    created_at: string;
  }[];
  recent_sessions: { session_id: string; module_id: string; module_plain: string; accuracy_pct: number; mean_latency_ms: number; started_at: string }[];
  recommendation: string;
}

/* ---- Section 13.4 HISTORY: every attempted quest, full per-attempt detail ---- */

export interface HistoryAttempt {
  id: number;
  position: number;
  item_id: string;
  item_kind: string;
  correct: boolean;
  input: string | null;
  expected: string | null;
  latency_ms: number;
  latency_delta_ms: number | null;
  error_code: string;
  error_category: string | null;
  char_position: number | null;
  counted_chars: number;
  correct_chars: number;
  slot_category: string | null;
  delayed_recall: boolean;
  clarity_score: number | null;
  question_shown: string | null;
  answer_given: string | null;
}

export interface HistoryEntry {
  session_id: string;
  module_id: string;
  module_name: string;
  phase: number;
  block_id: string | null;
  sublevel: number;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  accuracy_pct: number;
  mean_latency_ms: number;
  threshold_ms: number;
  speed_multiplier: number;
  char_correct: number;
  char_total: number;
  errors: string[];
  ape: Record<string, number>;
  is_delayed_recall: boolean;
  recall_of_session: string | null;
  attempt_count: number;
  error_count: number;
  attempts: HistoryAttempt[];
}

export interface HistoryTotals {
  attempts: number;
  correct: number;
  errors: number;
  sessions: number;
  accuracy_pct: number;
  session_accuracy_pct: number;
  total_duration_ms: number;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
  totals: HistoryTotals;
}

/* ---- Section 13.5 STATS: green/red movement, strengths, rank impact ---- */

export interface MovementCounts {
  green: number;
  red: number;
  flat: number;
  green_pct: number;
  red_pct: number;
}

export interface MetricStats extends MovementCounts {
  key: string;
  label: string;
  blurb: string;
  direction: 'up' | 'down';
  current: number;
  first: number;
  delta: number;
  change_pct: number;
  points: { at: string; value: number }[];
}

export interface StrengthWeakness {
  key: string;
  label: string;
  blurb: string;
  value: number;
  score: number;
}

export interface RankImpact {
  rank: string;
  label: string;
  at: string;
  sessions_since_previous: number | null;
}

export interface ModuleStat {
  module_id: string;
  sessions: number;
  attempts: number;
  correct: number;
  accuracy_pct: number;
  mean_latency_ms: number;
  last_played_at: string | null;
}

export interface StatsBundle {
  metrics: MetricStats[];
  overall: MovementCounts;
  strengths: StrengthWeakness[];
  weaknesses: StrengthWeakness[];
  rank_current: string | null;
  rank_current_label: string;
  rank_history: RankImpact[];
  promotions: number;
  demotions: number;
  modules: ModuleStat[];
  delayed_recall_pct: number;
  delayed_recall_accuracy_pct: number;
  standard_accuracy_pct: number;
}

/**
 * Section 16.3 — the one daily routine. The candidate sees the order and the
 * block titles; `selection_reason` exists for transparency in the teacher
 * surface and is deliberately not surfaced as a choice.
 */
export interface RoutineModule {
  order: number;
  module_id: ModuleId;
  selection_reason: string;
  lock_driven: boolean;
}

export interface RoutineStep {
  order: number;
  block: string;
  block_title: string;
  minutes: number;
  modules: RoutineModule[];
}

export interface DailyRoutine {
  candidate_id: string;
  date: string;
  rank: Rank;
  steps: RoutineStep[];
  empty_blocks: { block: string; reason: string }[];
}
