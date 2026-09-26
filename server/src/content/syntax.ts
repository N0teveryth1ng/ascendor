import type { ErrorCategory } from '../core/errorTags.js';
import type { SyntaxCeiling } from '../core/types.js';

/**
 * C2 syntax ceiling. Progressive construction tasks, increasing clause
 * complexity. Each task is a scaffold with exactly one blank and a closed
 * option set, so a failure is always attributable to a specific
 * construction category and can be tagged without a prose explanation.
 */
export interface SyntaxTask {
  id: string;
  level: SyntaxCeiling;
  construction: string;
  scaffold: string;
  options: string[];
  expected: string;
  category: ErrorCategory;
}

export const SYNTAX_LEVELS: SyntaxCeiling[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

export const SYNTAX_TASKS: SyntaxTask[] = [
  /* ── S1: noun phrase + article agreement ────────────────────────────────── */
  {
    id: 'S1-01', level: 'S1', construction: 'ARTICLE AGREEMENT',
    scaffold: 'The engineer opened ___ door to the server room.',
    options: ['its', "it's", 'their'], expected: 'its', category: 'article_agreement',
  },
  {
    id: 'S1-02', level: 'S1', construction: 'PLURAL AGREEMENT',
    scaffold: 'Three analysts submitted ___ reports before the deadline.',
    options: ['their', 'there', "they're"], expected: 'their', category: 'plural_agreement',
  },
  {
    id: 'S1-03', level: 'S1', construction: 'SUBJECT-VERB AGREEMENT',
    scaffold: 'The list of pending requests ___ still on the server.',
    options: ['is', 'are', 'were'], expected: 'is', category: 'voice_agreement',
  },
  {
    id: 'S1-04', level: 'S1', construction: 'POSSESSION',
    scaffold: 'The calibration log belongs ___ the candidate, not the trainer.',
    options: ['to', 'too', 'two'], expected: 'to', category: 'preposition_selection',
  },
  {
    id: 'S1-05', level: 'S1', construction: 'DEMONSTRATIVE',
    scaffold: '___ of the two latency readings came from the cached window.',
    options: ['One', 'Once', 'Won'], expected: 'One', category: 'lexical_selection',
  },
  {
    id: 'S1-06', level: 'S1', construction: 'COPULA SELECTION',
    scaffold: 'The remediation window ___ longer than the logging block.',
    options: ['is', 'are', 'be'], expected: 'is', category: 'voice_agreement',
  },

  /* ── S2: prepositional phrase attachment ────────────────────────────────── */
  {
    id: 'S2-01', level: 'S2', construction: 'PREPOSITION SELECTION',
    scaffold: 'The drill focuses ___ disambiguating minimal pairs.',
    options: ['on', 'in', 'at'], expected: 'on', category: 'preposition_selection',
  },
  {
    id: 'S2-02', level: 'S2', construction: 'PLACE VS MANNER',
    scaffold: 'She wrote the summary ___ the terminal, not ___ a phone.',
    options: ['at', 'on', 'in'], expected: 'at', category: 'preposition_selection',
  },
  {
    id: 'S2-03', level: 'S2', construction: 'TEMPORAL PREPOSITION',
    scaffold: 'The recalculation runs ___ the logging block closes.',
    options: ['after', 'before', 'during'], expected: 'after', category: 'preposition_selection',
  },
  {
    id: 'S2-04', level: 'S2', construction: 'AGENT PREPOSITION',
    scaffold: 'The threshold was recalculated ___ the pace engine.',
    options: ['by', 'to', 'for'], expected: 'by', category: 'preposition_selection',
  },
  {
    id: 'S2-05', level: 'S2', construction: 'DURATION',
    scaffold: 'Each remediation run lasts ___ ninety seconds.',
    options: ['for', 'during', 'while'], expected: 'for', category: 'preposition_selection',
  },
  {
    id: 'S2-06', level: 'S2', construction: 'DEPENDENCY',
    scaffold: 'Escalation depends ___ accuracy, not ___ speed.',
    options: ['on', 'in', 'at'], expected: 'on', category: 'preposition_selection',
  },

  /* ── S3: present perfect + time reference ───────────────────────────────── */
  {
    id: 'S3-01', level: 'S3', construction: 'PRESENT PERFECT',
    scaffold: 'The candidate ___ twelve sessions without a rank change.',
    options: ['has completed', 'completed', 'had completed'], expected: 'has completed',
    category: 'tense_marker',
  },
  {
    id: 'S3-02', level: 'S3', construction: 'PAST SIMPLE VS PRESENT PERFECT',
    scaffold: 'She ___ the calibration battery on Tuesday and ___ the drills since.',
    options: ['completed / has run', 'has completed / ran', 'completed / ran'],
    expected: 'completed / has run', category: 'tense_marker',
  },
  {
    id: 'S3-03', level: 'S3', construction: 'JUST/ALREADY',
    scaffold: 'The APE has ___ recalculated the threshold for this module.',
    options: ['already', 'still', 'yet'], expected: 'already', category: 'lexical_selection',
  },
  {
    id: 'S3-04', level: 'S3', construction: 'SINCE/FOR',
    scaffold: 'The lock has persisted ___ three consecutive sessions.',
    options: ['for', 'since', 'during'], expected: 'for', category: 'preposition_selection',
  },
  {
    id: 'S3-05', level: 'S3', construction: 'RECENTLY-COMPLETED ACTION',
    scaffold: 'He ___ the dictation block twenty minutes ago.',
    options: ['has just finished', 'finished', 'had finished'], expected: 'has just finished',
    category: 'tense_marker',
  },
  {
    id: 'S3-06', level: 'S3', construction: 'NEGATIVE PRESENT PERFECT',
    scaffold: 'The candidate ___ miss the daily threshold all week.',
    options: ['has not', 'did not', 'was not'], expected: 'has not', category: 'tense_marker',
  },

  /* ── S4: past perfect ───────────────────────────────────────────────────── */
  {
    id: 'S4-01', level: 'S4', construction: 'PAST PERFECT',
    scaffold: 'By the time the rank unlocked, she ___ every Phase 1 module.',
    options: ['had cleared', 'has cleared', 'clears'], expected: 'had cleared',
    category: 'past_perfect_construction',
  },
  {
    id: 'S4-02', level: 'S4', construction: 'PAST PERFECT VS PAST SIMPLE',
    scaffold: 'The threshold dropped because the engine ___ three tightening rounds already.',
    options: ['had applied', 'has applied', 'applies'], expected: 'had applied',
    category: 'past_perfect_construction',
  },
  {
    id: 'S4-03', level: 'S4', construction: 'PAST PERFECT NEGATIVE',
    scaffold: 'He never reported a Structural Lock because he ___ seen one before.',
    options: ["hadn't", "hasn't", "wasn't"], expected: "hadn't", category: 'past_perfect_construction',
  },
  {
    id: 'S4-04', level: 'S4', construction: 'MIXED TENSE SEQUENCE',
    scaffold: 'When the alert fired, the system ___ already four sessions of decline.',
    options: ['had recorded', 'has recorded', 'records'], expected: 'had recorded',
    category: 'past_perfect_construction',
  },
  {
    id: 'S4-05', level: 'S4', construction: 'PAST PERFECT MODAL',
    scaffold: 'The candidate ___ the module three times before this attempt.',
    options: ['had passed', 'has passed', 'passes'], expected: 'had passed',
    category: 'past_perfect_construction',
  },
  {
    id: 'S4-06', level: 'S4', construction: 'PAST PERFECT VS PRESENT PERFECT',
    scaffold: 'By 2024 the team ___ the migration twice and ___ since.',
    options: ['had run / has run', 'has run / ran', 'ran / had run'],
    expected: 'had run / has run', category: 'past_perfect_construction',
  },

  /* ── S5: passive voice ──────────────────────────────────────────────────── */
  {
    id: 'S5-01', level: 'S5', construction: 'PASSIVE VOICE',
    scaffold: 'All failed modules ___ by the scheduler before midnight.',
    options: ['were scheduled', 'scheduled', 'are scheduled'], expected: 'were scheduled',
    category: 'passive_voice',
  },
  {
    id: 'S5-02', level: 'S5', construction: 'PASSIVE WITH AGENT',
    scaffold: 'The lock was cleared ___ three consecutive clean sessions.',
    options: ['after', 'by', 'during'], expected: 'after', category: 'preposition_selection',
  },
  {
    id: 'S5-03', level: 'S5', construction: 'PASSIVE PRESENT PERFECT',
    scaffold: 'The baseline stats ___ never been cut by a failure tier.',
    options: ['have', 'had', 'are'], expected: 'have', category: 'passive_voice',
  },
  {
    id: 'S5-04', level: 'S5', construction: 'PASSIVE MODAL',
    scaffold: 'Thresholds ___ be tightened only after a qualifying trend.',
    options: ['may', 'might', 'must'], expected: 'may', category: 'passive_voice',
  },
  {
    id: 'S5-05', level: 'S5', construction: 'ACTIVE VOICE',
    scaffold: 'The pace engine recalculated the threshold after three clean rounds.',
    options: ['was recalculated', 'recalculated', 'had recalculate'], expected: 'recalculated',
    category: 'passive_voice',
  },
  {
    id: 'S5-06', level: 'S5', construction: 'GET-PASSIVE ALTERNATIVE',
    scaffold: 'The remediation run ___ scheduled twice because the first attempt failed.',
    options: ['got', 'was', 'been'], expected: 'got', category: 'passive_voice',
  },

  /* ── S6: relative clauses ───────────────────────────────────────────────── */
  {
    id: 'S6-01', level: 'S6', construction: 'RESTRICTIVE RELATIVE',
    scaffold: 'The candidates ___ train on independent tracks passed both audits.',
    options: ['who', 'which', 'that'], expected: 'who', category: 'relative_clause',
  },
  {
    id: 'S6-02', level: 'S6', construction: 'RELATIVE PRONOUN AGREEMENT',
    scaffold: 'The metric ___ measures character accuracy is the Precision Index.',
    options: ['which', 'who', 'whose'], expected: 'which', category: 'relative_clause',
  },
  {
    id: 'S6-03', level: 'S6', construction: 'POSSESSIVE RELATIVE',
    scaffold: '___ name is attached to the Personal Calibration Profile?',
    options: ['Whose', 'Who', 'Which'], expected: 'Whose', category: 'relative_clause',
  },
  {
    id: 'S6-04', level: 'S6', construction: 'NON-RESTRICTIVE RELATIVE',
    scaffold: 'Billi, ___ trains in the morning block, cleared Phase 2 last week.',
    options: ['who', 'that', 'which'], expected: 'who', category: 'relative_clause',
  },
  {
    id: 'S6-05', level: 'S6', construction: 'REDUCED RELATIVE',
    scaffold: 'The metrics ___ from the last eight sessions are shown in the header.',
    options: ['computed', 'computing', 'to compute'], expected: 'computed',
    category: 'relative_clause',
  },
  {
    id: 'S6-06', level: 'S6', construction: 'RELATIVE CLAUSE + TENSE',
    scaffold: 'The window ___ the engine recalculates spans eight sessions.',
    options: ['in which', 'which', 'that'], expected: 'in which', category: 'relative_clause',
  },

  /* ── S7: conditionals ───────────────────────────────────────────────────── */
  {
    id: 'S7-01', level: 'S7', construction: 'FIRST CONDITIONAL',
    scaffold: 'If the accuracy trend rises, the engine ___ the threshold.',
    options: ['will tighten', 'tightens', 'tightened'], expected: 'will tighten',
    category: 'conditional_construction',
  },
  {
    id: 'S7-02', level: 'S7', construction: 'SECOND CONDITIONAL',
    scaffold: 'If the system ___ overtuned, drills would be impossible regardless of skill.',
    options: ['were', 'is', 'has been'], expected: 'were', category: 'conditional_construction',
  },
  {
    id: 'S7-03', level: 'S7', construction: 'THIRD CONDITIONAL',
    scaffold: 'If the candidate had trained last month, the rank would already ___ unlocked.',
    options: ['have', 'have been', 'had been'], expected: 'have been',
    category: 'conditional_construction',
  },
  {
    id: 'S7-04', level: 'S7', construction: 'UNREAL CONDITIONAL MIX',
    scaffold: 'If she were less precise, her reflex latency ___ lower but her accuracy lower still.',
    options: ['would be', 'will be', 'is'], expected: 'would be',
    category: 'conditional_construction',
  },
  {
    id: 'S7-05', level: 'S7', construction: 'CONDITIONAL INVERSION',
    scaffold: '___ the trend hold, the APE will hold the factor at 1.00.',
    options: ['Should', 'Would', 'Could'], expected: 'Should',
    category: 'conditional_construction',
  },
  {
    id: 'S7-06', level: 'S7', construction: 'ZERO CONDITIONAL',
    scaffold: 'If a threshold is breached, the session ___ a STREAK_TERMINATED tag.',
    options: ['receives', 'received', 'would receive'], expected: 'receives',
    category: 'conditional_construction',
  },

  /* ── S8: multi-clause synthesis ─────────────────────────────────────────── */
  {
    id: 'S8-01', level: 'S8', construction: 'TEMPORAL CLAUSE + PAST PERFECT',
    scaffold: 'After the engine ___ tightened the threshold, accuracy fell below the band.',
    options: ['had', 'has', 'was'], expected: 'had', category: 'past_perfect_construction',
  },
  {
    id: 'S8-02', level: 'S8', construction: 'CONDITIONAL + PASSIVE',
    scaffold: 'If the lock had been cleared, the module ___ have escalated on time.',
    options: ['would', 'will', 'would of'], expected: 'would',
    category: 'conditional_construction',
  },
  {
    id: 'S8-03', level: 'S8', construction: 'RELATIVE + CONDITIONAL',
    scaffold: 'The candidate who ___ in the morning block faces a different latency baseline.',
    options: ['trains', 'trained', 'would train'], expected: 'trains',
    category: 'relative_clause',
  },
  {
    id: 'S8-04', level: 'S8', construction: 'CONCESSIVE CLAUSE',
    scaffold: '___ the accuracy was high, the latency failed the threshold twice.',
    options: ['Although', 'Because', 'Unless'], expected: 'Although',
    category: 'conditional_construction',
  },
  {
    id: 'S8-05', level: 'S8', construction: 'NESTED CONDITIONAL',
    scaffold: 'If the recalculation runs, and the trend holds, the factor stays ___ 1.00.',
    options: ['at', 'to', 'in'], expected: 'at', category: 'preposition_selection',
  },
  {
    id: 'S8-06', level: 'S8', construction: 'REPORTED SPEECH TENSE',
    scaffold: 'The system reported that the threshold ___ already recalculated.',
    options: ['had been', 'has been', 'was being'], expected: 'had been',
    category: 'past_perfect_construction',
  },
];

export function tasksForLevel(level: SyntaxCeiling): SyntaxTask[] {
  return SYNTAX_TASKS.filter((t) => t.level === level);
}

/**
 * Progressive search: start at S1 and advance until the first structural
 * failure. A level is cleared when all of its tasks pass.
 */
export function deriveSyntaxCeiling(results: { level: SyntaxCeiling; accuracy_pct: number }[]): SyntaxCeiling {
  let ceiling: SyntaxCeiling = 'S1';
  for (const level of SYNTAX_LEVELS) {
    const r = results.find((x) => x.level === level);
    if (!r) break;
    if (r.accuracy_pct >= 90) ceiling = level;
    else break;
  }
  return ceiling;
}
