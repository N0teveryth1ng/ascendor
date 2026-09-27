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
    scaffold: 'The parcel belongs ___ the neighbour, not the postman.',
    options: ['to', 'too', 'two'], expected: 'to', category: 'preposition_selection',
  },
  {
    id: 'S1-05', level: 'S1', construction: 'DEMONSTRATIVE',
    scaffold: '___ of the two cakes came from the bakery.',
    options: ['One', 'Once', 'Won'], expected: 'One', category: 'lexical_selection',
  },
  {
    id: 'S1-06', level: 'S1', construction: 'COPULA SELECTION',
    scaffold: 'The queue at the crossing ___ longer than usual this morning.',
    options: ['is', 'are', 'be'], expected: 'is', category: 'voice_agreement',
  },

  /* ── S2: prepositional phrase attachment ────────────────────────────────── */
  {
    id: 'S2-01', level: 'S2', construction: 'PREPOSITION SELECTION',
    scaffold: 'The lesson focuses ___ distinguishing similar sounds.',
    options: ['on', 'in', 'at'], expected: 'on', category: 'preposition_selection',
  },
  {
    id: 'S2-02', level: 'S2', construction: 'PLACE VS MANNER',
    scaffold: 'She wrote the summary ___ the terminal, not ___ a phone.',
    options: ['at', 'on', 'in'], expected: 'at', category: 'preposition_selection',
  },
  {
    id: 'S2-03', level: 'S2', construction: 'TEMPORAL PREPOSITION',
    scaffold: 'The train departs ___ the last passengers have boarded.',
    options: ['after', 'before', 'during'], expected: 'after', category: 'preposition_selection',
  },
  {
    id: 'S2-04', level: 'S2', construction: 'AGENT PREPOSITION',
    scaffold: 'The fence was repainted ___ the caretaker.',
    options: ['by', 'to', 'for'], expected: 'by', category: 'preposition_selection',
  },
  {
    id: 'S2-05', level: 'S2', construction: 'DURATION',
    scaffold: 'Each guided rehearsal lasts ___ ninety seconds.',
    options: ['for', 'during', 'while'], expected: 'for', category: 'preposition_selection',
  },
  {
    id: 'S2-06', level: 'S2', construction: 'DEPENDENCY',
    scaffold: 'The harvest depends ___ the weather, not ___ the season.',
    options: ['on', 'in', 'at'], expected: 'on', category: 'preposition_selection',
  },

  /* ── S3: present perfect + time reference ───────────────────────────────── */
  {
    id: 'S3-01', level: 'S3', construction: 'PRESENT PERFECT',
    scaffold: 'The gardener ___ twelve lawns without a single complaint.',
    options: ['has completed', 'completed', 'had completed'], expected: 'has completed',
    category: 'tense_marker',
  },
  {
    id: 'S3-02', level: 'S3', construction: 'PAST SIMPLE VS PRESENT PERFECT',
    scaffold: 'She ___ the short course on Tuesday and ___ the long course since.',
    options: ['completed / has run', 'has completed / ran', 'completed / ran'],
    expected: 'completed / has run', category: 'tense_marker',
  },
  {
    id: 'S3-03', level: 'S3', construction: 'JUST/ALREADY',
    scaffold: 'The chef has ___ prepared the sauce for this dinner.',
    options: ['already', 'still', 'yet'], expected: 'already', category: 'lexical_selection',
  },
  {
    id: 'S3-04', level: 'S3', construction: 'SINCE/FOR',
    scaffold: 'The rain has persisted ___ three consecutive days.',
    options: ['for', 'since', 'during'], expected: 'for', category: 'preposition_selection',
  },
  {
    id: 'S3-05', level: 'S3', construction: 'RECENTLY-COMPLETED ACTION',
    scaffold: 'He ___ the last chapter twenty minutes ago.',
    options: ['has just finished', 'finished', 'had finished'], expected: 'has just finished',
    category: 'tense_marker',
  },
  {
    id: 'S3-06', level: 'S3', construction: 'NEGATIVE PRESENT PERFECT',
    scaffold: 'The runner ___ miss a single training session all week.',
    options: ['has not', 'did not', 'was not'], expected: 'has not', category: 'tense_marker',
  },

  /* ── S4: past perfect ───────────────────────────────────────────────────── */
  {
    id: 'S4-01', level: 'S4', construction: 'PAST PERFECT',
    scaffold: 'By the time the concert ended, she ___ every box from the stage.',
    options: ['had cleared', 'has cleared', 'clears'], expected: 'had cleared',
    category: 'past_perfect_construction',
  },
  {
    id: 'S4-02', level: 'S4', construction: 'PAST PERFECT VS PAST SIMPLE',
    scaffold: 'The road reopened because the crew ___ three coats of paint already.',
    options: ['had applied', 'has applied', 'applies'], expected: 'had applied',
    category: 'past_perfect_construction',
  },
  {
    id: 'S4-03', level: 'S4', construction: 'PAST PERFECT NEGATIVE',
    scaffold: 'He never reported the broken stair because he ___ seen it before.',
    options: ["hadn't", "hasn't", "wasn't"], expected: "hadn't", category: 'past_perfect_construction',
  },
  {
    id: 'S4-04', level: 'S4', construction: 'MIXED TENSE SEQUENCE',
    scaffold: 'When the storm ended, the river ___ already four days of flooding.',
    options: ['had recorded', 'has recorded', 'records'], expected: 'had recorded',
    category: 'past_perfect_construction',
  },
  {
    id: 'S4-05', level: 'S4', construction: 'PAST PERFECT MODAL',
    scaffold: 'The climber ___ the summit three times before this attempt.',
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
    scaffold: 'All the day tours ___ by the travel agent before the season began.',
    options: ['were scheduled', 'scheduled', 'are scheduled'], expected: 'were scheduled',
    category: 'passive_voice',
  },
  {
    id: 'S5-02', level: 'S5', construction: 'PASSIVE WITH AGENT',
    scaffold: 'The hall was booked ___ three weeks in advance.',
    options: ['after', 'by', 'during'], expected: 'after', category: 'preposition_selection',
  },
  {
    id: 'S5-03', level: 'S5', construction: 'PASSIVE PRESENT PERFECT',
    scaffold: 'The old silent film ___ never been copied before this year.',
    options: ['have', 'had', 'are'], expected: 'have', category: 'passive_voice',
  },
  {
    id: 'S5-04', level: 'S5', construction: 'PASSIVE MODAL',
    scaffold: 'Old batteries ___ be replaced only after a full winter.',
    options: ['may', 'might', 'must'], expected: 'may', category: 'passive_voice',
  },
  {
    id: 'S5-05', level: 'S5', construction: 'ACTIVE VOICE',
    // The gap was missing, so this shipped as a finished sentence whose three
    // options could not be applied to it. It is the active-voice counterpart to
    // S5-06's passive, and the options were already written for the gap.
    scaffold: 'The young teacher ___ the exam papers after the long delay.',
    options: ['was marked', 'marked', 'had mark'], expected: 'marked',
    category: 'passive_voice',
  },
  {
    id: 'S5-06', level: 'S5', construction: 'GET-PASSIVE ALTERNATIVE',
    scaffold: 'The kitchen ___ repainted twice because the first attempt failed.',
    options: ['got', 'was', 'been'], expected: 'got', category: 'passive_voice',
  },

  /* ── S6: relative clauses ───────────────────────────────────────────────── */
  {
    id: 'S6-01', level: 'S6', construction: 'RESTRICTIVE RELATIVE',
    scaffold: 'The students ___ study in the evening class passed both exams.',
    options: ['who', 'which', 'that'], expected: 'who', category: 'relative_clause',
  },
  {
    id: 'S6-02', level: 'S6', construction: 'RELATIVE PRONOUN AGREEMENT',
    scaffold: 'The lamp ___ stands beside the sofa is the old one.',
    options: ['which', 'who', 'whose'], expected: 'which', category: 'relative_clause',
  },
  {
    id: 'S6-03', level: 'S6', construction: 'POSSESSIVE RELATIVE',
    scaffold: '___ bicycle is chained to the railings outside?',
    options: ['Whose', 'Who', 'Which'], expected: 'Whose', category: 'relative_clause',
  },
  {
    id: 'S6-04', level: 'S6', construction: 'NON-RESTRICTIVE RELATIVE',
    scaffold: 'Priya, ___ teaches swimming on Tuesdays, retired last spring.',
    options: ['who', 'that', 'which'], expected: 'who', category: 'relative_clause',
  },
  {
    id: 'S6-05', level: 'S6', construction: 'REDUCED RELATIVE',
    scaffold: 'The totals ___ from the last eight weeks are chalked on the board.',
    options: ['computed', 'computing', 'to compute'], expected: 'computed',
    category: 'relative_clause',
  },
  {
    id: 'S6-06', level: 'S6', construction: 'RELATIVE CLAUSE + TENSE',
    scaffold: 'The room ___ the children use for music has a new piano.',
    options: ['in which', 'which', 'that'], expected: 'in which', category: 'relative_clause',
  },

  /* ── S7: conditionals ───────────────────────────────────────────────────── */
  {
    id: 'S7-01', level: 'S7', construction: 'FIRST CONDITIONAL',
    scaffold: 'If the queue grows, the baker ___ the schedule.',
    options: ['will tighten', 'tightens', 'tightened'], expected: 'will tighten',
    category: 'conditional_construction',
  },
  {
    id: 'S7-02', level: 'S7', construction: 'SECOND CONDITIONAL',
    scaffold: 'If the instrument ___ badly tuned, the concert would sound wrong regardless of skill.',
    options: ['were', 'is', 'has been'], expected: 'were', category: 'conditional_construction',
  },
  {
    id: 'S7-03', level: 'S7', construction: 'THIRD CONDITIONAL',
    scaffold: 'If she had left an hour earlier, she would already ___ home.',
    options: ['have', 'have been', 'had been'], expected: 'have been',
    category: 'conditional_construction',
  },
  {
    id: 'S7-04', level: 'S7', construction: 'UNREAL CONDITIONAL MIX',
    scaffold: 'If he were less careful, his handwriting ___ neater but his reading slower still.',
    options: ['would be', 'will be', 'is'], expected: 'would be',
    category: 'conditional_construction',
  },
  {
    id: 'S7-05', level: 'S7', construction: 'CONDITIONAL INVERSION',
    scaffold: '___ the weather hold, the ferry will sail at six.',
    options: ['Should', 'Would', 'Could'], expected: 'Should',
    category: 'conditional_construction',
  },
  {
    id: 'S7-06', level: 'S7', construction: 'ZERO CONDITIONAL',
    scaffold: 'If a fuse blows, the lamp ___ a faint hum.',
    options: ['receives', 'received', 'would receive'], expected: 'receives',
    category: 'conditional_construction',
  },

  /* ── S8: multi-clause synthesis ─────────────────────────────────────────── */
  {
    id: 'S8-01', level: 'S8', construction: 'TEMPORAL CLAUSE + PAST PERFECT',
    scaffold: 'After the baker ___ finished the icing, the guests arrived.',
    options: ['had', 'has', 'was'], expected: 'had', category: 'past_perfect_construction',
  },
  {
    id: 'S8-02', level: 'S8', construction: 'CONDITIONAL + PASSIVE',
    scaffold: 'If the road had been gritted earlier, the buses ___ have arrived on time.',
    options: ['would', 'will', 'would of'], expected: 'would',
    category: 'conditional_construction',
  },
  {
    id: 'S8-03', level: 'S8', construction: 'RELATIVE + CONDITIONAL',
    scaffold: 'The swimmer who ___ in the early block has an empty lane.',
    options: ['trains', 'trained', 'would train'], expected: 'trains',
    category: 'relative_clause',
  },
  {
    id: 'S8-04', level: 'S8', construction: 'CONCESSIVE CLAUSE',
    scaffold: '___ the road was dry, the car skidded twice.',
    options: ['Although', 'Because', 'Unless'], expected: 'Although',
    category: 'conditional_construction',
  },
  {
    id: 'S8-05', level: 'S8', construction: 'NESTED CONDITIONAL',
    scaffold: 'If the rehearsal starts on time, and the choir arrives, the concert begins ___ six.',
    options: ['at', 'to', 'in'], expected: 'at', category: 'preposition_selection',
  },
  {
    id: 'S8-06', level: 'S8', construction: 'REPORTED SPEECH TENSE',
    scaffold: 'The manager reported that the invoice ___ already approved.',
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
