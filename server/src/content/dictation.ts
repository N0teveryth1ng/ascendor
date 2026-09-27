import type { ErrorCategory } from '../core/errorTags.js';
import type { VocabularyBand } from '../core/types.js';

/* ── C5 / 7.2.1 Rapid Dictation Intercept ─────────────────────────────────── */

export interface DictationTrap {
  /** The homophone class under test. */
  category: ErrorCategory;
  /** Correct spelling expected in the passage. */
  correct: string;
  /** The near-miss the candidate is likely to produce. */
  decoy: string;
}

export interface DictationItem {
  id: string;
  min_band: VocabularyBand;
  /** Spoken stimulus. Rendered via SpeechSynthesis; scored on typed input. */
  text: string;
  trap: DictationTrap | null;
  /** typo = orthographic fault, pattern = word-choice fault. */
  mode: 'typo' | 'pattern';
}

/**
 * C5 runs untimed first to establish the orthographic ceiling, then the same
 * content at increasing speed to find where accuracy collapses under load.
 */
export const DICTATION_ITEMS: DictationItem[] = [
  { id: 'DT-01', min_band: 'V1', text: 'The threshold was recalculated after three clean sessions.', trap: null, mode: 'typo' },
  { id: 'DT-02', min_band: 'V1', text: 'The candidates submitted their calibration profiles.', trap: { category: 'homophone_their_there', correct: 'their', decoy: 'there' }, mode: 'typo' },
  { id: 'DT-03', min_band: 'V1', text: 'There were two structural locks active in Phase Two.', trap: { category: 'homophone_their_there', correct: 'There', decoy: 'Their' }, mode: 'typo' },
  { id: 'DT-04', min_band: 'V1', text: "They're drilling on independent tracks with no shared gate.", trap: { category: 'homophone_there_theyre', correct: "They're", decoy: 'There' }, mode: 'typo' },
  { id: 'DT-05', min_band: 'V1', text: 'Check your reflex latency against the personal baseline.', trap: { category: 'homophone_your_youre', correct: 'your', decoy: "you're" }, mode: 'typo' },
  { id: 'DT-06', min_band: 'V1', text: "You're operating below the APE threshold for three sessions.", trap: { category: 'homophone_your_youre', correct: "You're", decoy: 'Your' }, mode: 'typo' },
  { id: 'DT-07', min_band: 'V1', text: 'The batch was routed to the secondary node.', trap: { category: 'homophone_to_too_two', correct: 'to', decoy: 'too' }, mode: 'typo' },
  { id: 'DT-08', min_band: 'V1', text: 'Exactly two modules failed the daily threshold.', trap: { category: 'homophone_to_too_two', correct: 'two', decoy: 'to' }, mode: 'typo' },
  { id: 'DT-09', min_band: 'V1', text: 'The tightening was too aggressive for this candidate.', trap: { category: 'homophone_to_too_two', correct: 'too', decoy: 'to' }, mode: 'typo' },
  { id: 'DT-10', min_band: 'V1', text: "The system's rollback point is recorded in the adjustment log.", trap: { category: 'article_agreement', correct: "system's", decoy: 'systems' }, mode: 'pattern' },
  { id: 'DT-11', min_band: 'V2', text: 'The pace engine will raise the threshold when accuracy improves.', trap: { category: 'lexical_selection', correct: 'raise', decoy: 'rise' }, mode: 'pattern' },
  { id: 'DT-12', min_band: 'V2', text: 'Rolling accuracy will rise by roughly five points this week.', trap: { category: 'lexical_selection', correct: 'rise', decoy: 'raise' }, mode: 'pattern' },
  { id: 'DT-13', min_band: 'V2', text: 'A sustained negative trend will affect the next factor calculation.', trap: { category: 'lexical_selection', correct: 'affect', decoy: 'effect' }, mode: 'pattern' },
  { id: 'DT-14', min_band: 'V2', text: 'The effect of three tightening rounds was a twelve percent accuracy drop.', trap: { category: 'lexical_selection', correct: 'effect', decoy: 'affect' }, mode: 'pattern' },
  { id: 'DT-15', min_band: 'V2', text: 'Only fewer locks remain active in the current window.', trap: { category: 'lexical_selection', correct: 'fewer', decoy: 'less' }, mode: 'pattern' },
  { id: 'DT-16', min_band: 'V2', text: 'The engine could not push the threshold below the statistical floor.', trap: { category: 'conditional_construction', correct: 'could', decoy: 'would' }, mode: 'pattern' },
  { id: 'DT-17', min_band: 'V3', text: 'By the time the rank unlocked, she had cleared every Phase One module.', trap: { category: 'past_perfect_construction', correct: 'had cleared', decoy: 'has cleared' }, mode: 'pattern' },
  { id: 'DT-18', min_band: 'V3', text: 'The threshold dropped because the engine had applied three tightening rounds.', trap: { category: 'past_perfect_construction', correct: 'had applied', decoy: 'has applied' }, mode: 'pattern' },
  { id: 'DT-19', min_band: 'V3', text: 'He never reported a structural lock because he had not seen one before.', trap: { category: 'past_perfect_construction', correct: 'had not', decoy: 'has not' }, mode: 'pattern' },
  { id: 'DT-20', min_band: 'V3', text: 'The candidate who trains in the morning block faces a different latency baseline.', trap: { category: 'relative_clause', correct: 'who', decoy: 'which' }, mode: 'pattern' },
  { id: 'DT-21', min_band: 'V3', text: 'The metric which measures character accuracy is the Precision Index.', trap: { category: 'relative_clause', correct: 'which', decoy: 'who' }, mode: 'pattern' },
  { id: 'DT-22', min_band: 'V3', text: 'If the accuracy trend rises, the engine will tighten the threshold.', trap: { category: 'conditional_construction', correct: 'will tighten', decoy: 'tightens' }, mode: 'pattern' },
  { id: 'DT-23', min_band: 'V4', text: 'All failed modules were scheduled by the scheduler before midnight.', trap: { category: 'passive_voice', correct: 'were scheduled', decoy: 'was scheduled' }, mode: 'pattern' },
  { id: 'DT-24', min_band: 'V4', text: 'The baseline stats have never been cut by a failure tier.', trap: { category: 'passive_voice', correct: 'have', decoy: 'had' }, mode: 'pattern' },
  { id: 'DT-25', min_band: 'V4', text: 'The lock was cleared after three consecutive clean sessions.', trap: { category: 'preposition_selection', correct: 'after', decoy: 'by' }, mode: 'pattern' },
  { id: 'DT-26', min_band: 'V4', text: 'Whose accuracy declined for four consecutive sessions is recorded in the log.', trap: { category: 'relative_clause', correct: 'Whose', decoy: "Who's" }, mode: 'pattern' },
  { id: 'DT-27', min_band: 'V5', text: 'The remediation run diverts fifteen percent of the next three sessions.', trap: { category: 'spelling_error', correct: 'diverts', decoy: 'diverses' }, mode: 'typo' },
  { id: 'DT-28', min_band: 'V5', text: 'Escalation is capped on a specific weak vector without halting progression.', trap: { category: 'spelling_error', correct: 'capped', decoy: 'cappped' }, mode: 'typo' },
  { id: 'DT-29', min_band: 'V5', text: 'The pressure chamber stops reducing its window when accuracy falls below ninety eight.', trap: { category: 'spelling_error', correct: 'chamber', decoy: 'chaber' }, mode: 'typo' },
  { id: 'DT-30', min_band: 'V6', text: 'The discrepancy was sufficient to invalidate the batch but not the baseline.', trap: { category: 'lexical_selection', correct: 'sufficient', decoy: 'efficient' }, mode: 'pattern' },
  { id: 'DT-31', min_band: 'V6', text: 'Retention density weights delayed recall above same session recall.', trap: { category: 'spelling_error', correct: 'retention', decoy: 'retencion' }, mode: 'typo' },
  { id: 'DT-32', min_band: 'V7', text: 'The immutable baseline survives sustained degradation but never a punitive cut.', trap: { category: 'lexical_selection', correct: 'immutable', decoy: 'mutable' }, mode: 'pattern' },
  { id: 'DT-33', min_band: 'V8', text: 'An escalating system must not guarantee failure regardless of demonstrated skill.', trap: { category: 'lexical_selection', correct: 'escalating', decoy: 'escalateing' }, mode: 'typo' },
  { id: 'DT-34', min_band: 'V9', text: "The trajectory of latency is normalized against the candidate's own baseline.", trap: { category: 'article_agreement', correct: "candidate's own", decoy: 'candidate own' }, mode: 'pattern' },
  { id: 'DT-35', min_band: 'V10', text: 'A negligible variance in the untimed pass is discarded from the timed pass.', trap: { category: 'lexical_selection', correct: 'discarded', decoy: 'discarfed' }, mode: 'typo' },
  { id: 'DT-36', min_band: 'V11', text: 'The proactive clamp precludes a scenario in which thresholds render drills impossible.', trap: { category: 'lexical_selection', correct: 'precludes', decoy: 'prequles' }, mode: 'typo' },
];

export function dictationItemsForBand(band: VocabularyBand, allBands: VocabularyBand[]): DictationItem[] {
  const cap = allBands.indexOf(band);
  return DICTATION_ITEMS.filter((d) => allBands.indexOf(d.min_band) <= cap);
}

/* ── C3 Aural processing ladder ───────────────────────────────────────────── */

/**
 * C3: audio played at increasing WPM; the candidate transcribes. The WPM
 * where accuracy drops below 90% is the baseline RL seed.
 */
export const AURAL_LADDER_WPM = [70, 90, 110, 130, 150, 175, 200, 225, 250, 280, 310, 340];
export const AURAL_ACCURACY_FLOOR_PCT = 90;

export const AURAL_PROBES: { wpm: number; text: string }[] = AURAL_LADDER_WPM.map((wpm, i) => ({
  wpm,
  text: [
    'the recalculation runs after the logging block closes and the threshold is held for the next session',
    'accuracy rose across three consecutive sessions so the engine tightened the response window by a small margin',
    'a structural lock caps escalation on one weak vector without halting overall progression in the module',
    'delayed recall carries twice the weight of fresh recall because it measures retention rather than buffer',
    'the pressure chamber stops reducing its window when rolling accuracy would fall under ninety eight percent',
    'baseline stats remain immutable downward except through genuine multi session performance degradation',
    'the candidate failed one module so the scheduler repeats only that module at the current calculated threshold',
    'when the reflex latency exceeds the personal baseline the drill is retried without a statistical penalty',
    'the discrepancy between the two candidates is measured in meaning and never in raw milliseconds alone',
    'no lockout is applied on a failed day because lockouts train candidates to avoid the system entirely',
    'the remediation diverts fifteen percent of the next three sessions until recurrence falls below two',
    'sustained phase four performance across a thirty day window qualifies the master rank without a single test',
  ][i] as string,
}));
