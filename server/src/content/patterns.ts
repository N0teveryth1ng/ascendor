import type { ErrorCategory } from '../core/errorTags.js';
import type { VocabularyBand } from '../core/types.js';

/* ── 7.1.1 Vector Disambiguation ──────────────────────────────────────────── */

export interface PatternItem {
  id: string;
  pair: [string, string];
  /** Time / action marker the pair is disambiguated against. */
  marker: string;
  prompt: string;
  expected: string;
  distractor: string;
  category: ErrorCategory;
  min_band: VocabularyBand;
}

/**
 * Ambiguous pairs flashed against a time/action marker. The pair is the
 * stimulus; the marker disambiguates which member is correct. An error is
 * therefore always attributable to a specific lexical category.
 */
export const PATTERN_ITEMS: PatternItem[] = [
  { id: 'VD-001', pair: ['want', 'went'], marker: 'PAST — SINGLE OCCURRENCE', prompt: 'She ___ to the calibration lab once, in March.', expected: 'went', distractor: 'want', category: 'tense_marker', min_band: 'V1' },
  { id: 'VD-002', pair: ['want', 'went'], marker: 'HABITUAL — DAILY', prompt: 'He ___ to the terminal every morning at 06:00.', expected: 'want', distractor: 'went', category: 'tense_marker', min_band: 'V1' },
  { id: 'VD-003', pair: ['there', 'their'], marker: 'POSSESSIVE — OF THEM', prompt: 'The two candidates submitted ___ calibration profiles.', expected: 'their', distractor: 'there', category: 'homophone_their_there', min_band: 'V1' },
  { id: 'VD-004', pair: ['there', 'their'], marker: 'EXISTENTIAL — PLACE', prompt: '___ were two Structural Locks active in Phase 2.', expected: 'there', distractor: 'their', category: 'homophone_their_there', min_band: 'V1' },
  { id: 'VD-005', pair: ["there", "they're"], marker: 'IDENTITY — THE CANDIDATES', prompt: "___ drilling on separate tracks with no shared gate.", expected: "they're", distractor: 'there', category: 'homophone_there_theyre', min_band: 'V1' },
  { id: 'VD-006', pair: ['their', "they're"], marker: 'IDENTITY — THE CANDIDATES', prompt: "___ both cleared the RANK 02: OPERATOR gate.", expected: "they're", distractor: 'their', category: 'homophone_their_theyre', min_band: 'V1' },
  { id: 'VD-007', pair: ['your', "you're"], marker: 'POSSESSIVE — SECOND PERSON', prompt: 'Check ___ Reflex Latency against the calibration baseline.', expected: 'your', distractor: "you're", category: 'homophone_your_youre', min_band: 'V1' },
  { id: 'VD-008', pair: ['your', "you're"], marker: 'IDENTITY — SECOND PERSON', prompt: "___ operating below the APE threshold for three sessions.", expected: "you're", distractor: 'your', category: 'homophone_your_youre', min_band: 'V1' },
  { id: 'VD-009', pair: ['to', 'too'], marker: 'DIRECTION / RECIPIENT', prompt: 'The batch job was routed ___ the secondary node.', expected: 'to', distractor: 'too', category: 'homophone_to_too_two', min_band: 'V1' },
  { id: 'VD-010', pair: ['to', 'too'], marker: 'EXCESS — DEGREE', prompt: 'The threshold was tightened ___ aggressively for this candidate.', expected: 'too', distractor: 'to', category: 'homophone_to_too_two', min_band: 'V1' },
  { id: 'VD-011', pair: ['to', 'two'], marker: 'QUANTITY — CARDINAL', prompt: 'Exactly ___ modules failed the daily threshold.', expected: 'two', distractor: 'to', category: 'homophone_to_too_two', min_band: 'V1' },
  { id: 'VD-012', pair: ['affect', 'effect'], marker: 'VERB — TO INFLUENCE', prompt: 'A sustained negative trend will ___ the next factor calculation.', expected: 'affect', distractor: 'effect', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-013', pair: ['affect', 'effect'], marker: 'NOUN — RESULT', prompt: 'The ___ of three tightening rounds was a 12% accuracy drop.', expected: 'effect', distractor: 'affect', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-014', pair: ['raise', 'rise'], marker: 'CAUSATIVE — TO CAUSE', prompt: 'The APE will ___ the threshold when accuracy improves.', expected: 'raise', distractor: 'rise', category: 'lexical_selection', min_band: 'V2' },
  { id: 'VD-015', pair: ['raise', 'rise'], marker: 'INTRANSITIVE — TO GO UP', prompt: 'Rolling accuracy will ___ by roughly five points this week.', expected: 'rise', distractor: 'raise', category: 'lexical_selection', min_band: 'V2' },
  { id: 'VD-016', pair: ['lie', 'lay'], marker: 'INTRANSITIVE — TO REST', prompt: 'The dormant modules ___ outside the current phase window.', expected: 'lie', distractor: 'lay', category: 'tense_marker', min_band: 'V2' },
  { id: 'VD-017', pair: ['lie', 'lay'], marker: 'TRANSITIVE — TO PLACE', prompt: 'The scheduler will ___ the remediation block first.', expected: 'lay', distractor: 'lie', category: 'tense_marker', min_band: 'V2' },
  { id: 'VD-018', pair: ['then', 'than'], marker: 'SEQUENCE — AFTER THAT', prompt: 'The APE holds the factor; ___ the block closes, logging runs.', expected: 'then', distractor: 'than', category: 'lexical_selection', min_band: 'V1' },
  { id: 'VD-019', pair: ['then', 'than'], marker: 'COMPARISON — GREATER THAN', prompt: "Candidate B's latency is higher ___ candidate A's baseline.", expected: 'than', distractor: 'then', category: 'lexical_selection', min_band: 'V1' },
  { id: 'VD-020', pair: ['accept', 'except'], marker: 'VERB — TO RECEIVE', prompt: 'The engine will ___ the new sub-level without a rank change.', expected: 'accept', distractor: 'except', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-021', pair: ['accept', 'except'], marker: 'PREPOSITION — APART FROM', prompt: 'All Phase 1 modules passed ___ RAPID DICTATION INTERCEPT.', expected: 'except', distractor: 'accept', category: 'preposition_selection', min_band: 'V3' },
  { id: 'VD-022', pair: ['complement', 'compliment'], marker: 'NOUN — TO COMPLETE', prompt: 'The delayed recall set serves as a ___ to the same-session pass.', expected: 'complement', distractor: 'compliment', category: 'lexical_selection', min_band: 'V4' },
  { id: 'VD-023', pair: ['ensure', 'insure'], marker: 'VERB — TO MAKE CERTAIN', prompt: 'The clamps will ___ the threshold never falls below the floor.', expected: 'ensure', distractor: 'insure', category: 'lexical_selection', min_band: 'V4' },
  { id: 'VD-024', pair: ['principal', 'principle'], marker: 'NOUN — HEAD OF A SCHOOL', prompt: 'The ___ of the language institute signed off on the battery.', expected: 'principal', distractor: 'principle', category: 'lexical_selection', min_band: 'V4' },
  { id: 'VD-025', pair: ['principal', 'principle'], marker: 'NOUN — A FUNDAMENTAL RULE', prompt: 'Baseline stats are never cut — that is a core ___ of the system.', expected: 'principle', distractor: 'principal', category: 'lexical_selection', min_band: 'V4' },
  { id: 'VD-026', pair: ['adapt', 'adopt'], marker: 'VERB — TO ADJUST TO', prompt: 'The APE will ___ the curve to the candidate\'s trajectory.', expected: 'adapt', distractor: 'adopt', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-027', pair: ['adapt', 'adopt'], marker: 'VERB — TO TAKE UP', prompt: 'The cohort will ___ a single shared APE configuration.', expected: 'adopt', distractor: 'adapt', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-028', pair: ['sight', 'site'], marker: 'NOUN — VISION', prompt: 'Line-of-___ was never part of the scoring criteria.', expected: 'sight', distractor: 'site', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-029', pair: ['sight', 'site'], marker: 'NOUN — LOCATION', prompt: 'The drill ___ is deployed on the local node only.', expected: 'site', distractor: 'sight', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-030', pair: ['discrete', 'discreet'], marker: 'ADJ — SEPARATE, DISTINCT', prompt: 'The APE evaluates each module as a ___ sub-system.', expected: 'discrete', distractor: 'discreet', category: 'lexical_selection', min_band: 'V5' },
  { id: 'VD-031', pair: ['form', 'from'], marker: 'NOUN — A SHAPE / STRUCTURE', prompt: 'The error tag carries the exact ___ of the failure.', expected: 'form', distractor: 'from', category: 'lexical_selection', min_band: 'V2' },
  { id: 'VD-032', pair: ['form', 'from'], marker: 'PREPOSITION — ORIGIN', prompt: 'The PCP is generated ___ the raw calibration vectors.', expected: 'from', distractor: 'form', category: 'preposition_selection', min_band: 'V2' },
  { id: 'VD-033', pair: ['practice', 'practise'], marker: 'NOUN — REPEATED EXERCISE', prompt: 'Daily ___ is a hard requirement, not a suggestion.', expected: 'practice', distractor: 'practise', category: 'lexical_selection', min_band: 'V3' },
  { id: 'VD-034', pair: ['farther', 'further'], marker: 'ADJ — PHYSICAL DISTANCE', prompt: 'The remediation block is ___ from the logging block than the base plan.', expected: 'farther', distractor: 'further', category: 'lexical_selection', min_band: 'V4' },
  { id: 'VD-035', pair: ['who', 'whom'], marker: 'SUBJECT — HE/SHE/ THEY', prompt: '___ owns the candidate_profile table?', expected: 'who', distractor: 'whom', category: 'relative_clause', min_band: 'V3' },
  { id: 'VD-036', pair: ['who', 'whom'], marker: 'OBJECT — HIM/HER/ THEM', prompt: 'The APE adjusts the curve for ___ , not for the cohort.', expected: 'whom', distractor: 'who', category: 'relative_clause', min_band: 'V3' },
  { id: 'VD-037', pair: ['its', "it's"], marker: 'POSSESSIVE — OF IT', prompt: '___ rollback point is recorded in the adjustment log.', expected: 'its', distractor: "it's", category: 'article_agreement', min_band: 'V1' },
  { id: 'VD-038', pair: ['whose', "who's"], marker: 'POSSESSIVE RELATIVE', prompt: '___ accuracy declined for four consecutive sessions?', expected: 'whose', distractor: "who's", category: 'relative_clause', min_band: 'V3' },
  { id: 'VD-039', pair: ['lead', 'led'], marker: 'VERB — TO GUIDE / TO BE FIRST', prompt: 'The Pressure Chamber will ___ four tasks in parallel.', expected: 'lead', distractor: 'led', category: 'tense_marker', min_band: 'V2' },
  { id: 'VD-040', pair: ['lead', 'led'], marker: 'VERB — PAST OF LEAD', prompt: 'She ___ the calibration battery for both candidates last week.', expected: 'led', distractor: 'lead', category: 'tense_marker', min_band: 'V2' },
  { id: 'VD-041', pair: ['could', 'would'], marker: 'PAST ABILITY / POSSIBILITY', prompt: 'The engine ___ not push the threshold below the statistical floor.', expected: 'could', distractor: 'would', category: 'conditional_construction', min_band: 'V2' },
  { id: 'VD-042', pair: ['fewer', 'less'], marker: 'COUNTABLE ITEMS', prompt: 'Only ___ Structural Locks remain active in this window.', expected: 'fewer', distractor: 'less', category: 'lexical_selection', min_band: 'V2' },
  { id: 'VD-043', pair: ['altar', 'alter'], marker: 'NOUN — RAISED STRUCTURE', prompt: 'No ___ was erected. The voice bank was rebuilt instead.', expected: 'altar', distractor: 'alter', category: 'lexical_selection', min_band: 'V6' },
  { id: 'VD-044', pair: ['idle', 'idol'], marker: 'ADJ — UNUSED', prompt: 'The module stays ___ until the rank gate unlocks it.', expected: 'idle', distractor: 'idol', category: 'lexical_selection', min_band: 'V3' },
];

export function patternItemsForBand(band: VocabularyBand, allBands: VocabularyBand[]): PatternItem[] {
  const cap = allBands.indexOf(band);
  return PATTERN_ITEMS.filter((p) => allBands.indexOf(p.min_band) <= cap);
}

/* ── 7.3.1 Slot-Substitution Matrix ───────────────────────────────────────── */

export interface SlotItem {
  id: string;
  /** IF + [VAR A] -> THEN + [VAR B] */
  varA: string;
  varB: string;
  /** The frame shown before the swap. */
  frameA: string;
  /** The swapped condition the candidate must answer a consequence for. */
  swappedCondition: string;
  /** Expected consequence token(s) after the swap. */
  expected: string;
  distractor: string;
  category: ErrorCategory;
  min_band: VocabularyBand;
}

export const SLOT_ITEMS: SlotItem[] = [
  { id: 'SS-01', varA: 'accuracy rises 3 steps', varB: 'factor 0.93', frameA: 'IF accuracy rises 3 steps -> THEN factor 0.93', swappedCondition: 'IF accuracy rises 5 steps', expected: '0.93', distractor: '1.00', category: 'slot_then_consequence', min_band: 'V1' },
  { id: 'SS-02', varA: 'accuracy falls 8 steps', varB: 'factor 1.08', frameA: 'IF accuracy falls 8 steps -> THEN factor 1.08', swappedCondition: 'IF accuracy falls 10 steps', expected: '1.08', distractor: '0.93', category: 'slot_then_consequence', min_band: 'V1' },
  { id: 'SS-03', varA: 'accuracy holds in band', varB: 'factor 1.00', frameA: 'IF accuracy holds in band -> THEN factor 1.00', swappedCondition: 'IF latency holds in band', expected: '1.00', distractor: '0.93', category: 'slot_then_consequence', min_band: 'V1' },
  { id: 'SS-04', varA: 'tag recurs 4 sessions', varB: 'structural lock', frameA: 'IF tag recurs 4 sessions -> THEN structural lock', swappedCondition: 'IF tag recurs 6 sessions', expected: 'structural lock', distractor: 'escalation', category: 'slot_if_condition', min_band: 'V2' },
  { id: 'SS-05', varA: 'accuracy in band 3 sessions', varB: 'sublevel +1', frameA: 'IF accuracy in band 3 sessions -> THEN sublevel +1', swappedCondition: 'IF accuracy in band 4 sessions', expected: 'sublevel +1', distractor: 'rank change', category: 'slot_var_b', min_band: 'V2' },
  { id: 'SS-06', varA: 'daily aggregate 93%', varB: 'streak reset', frameA: 'IF daily aggregate 93% -> THEN streak reset', swappedCondition: 'IF daily aggregate 90%', expected: 'streak reset', distractor: 'lockout', category: 'slot_var_b', min_band: 'V2' },
  { id: 'SS-07', varA: 'daily aggregate 82%', varB: 'forced repeat', frameA: 'IF daily aggregate 82% -> THEN forced repeat', swappedCondition: 'IF daily aggregate 79%', expected: 'forced repeat', distractor: 'stat cut', category: 'slot_var_b', min_band: 'V2' },
  { id: 'SS-08', varA: 'no lock 14 days', varB: 'STRIKER eligible', frameA: 'IF no lock 14 days -> THEN STRIKER eligible', swappedCondition: 'IF no lock 21 days', expected: 'STRIKER eligible', distractor: 'MASTER eligible', category: 'slot_then_consequence', min_band: 'V3' },
  { id: 'SS-09', varA: 'Phase 4 mean 98.4%', varB: 'MASTER window qualifies', frameA: 'IF Phase 4 mean 98.4% -> THEN MASTER window qualifies', swappedCondition: 'IF Phase 4 mean 97.2%', expected: 'no qualification', distractor: 'MASTER window qualifies', category: 'slot_then_consequence', min_band: 'V4' },
  { id: 'SS-10', varA: 'threshold at floor', varB: 'clamp MIN', frameA: 'IF threshold at floor -> THEN clamp MIN', swappedCondition: 'IF threshold at ceiling', expected: 'clamp MAX', distractor: 'clamp MIN', category: 'slot_then_consequence', min_band: 'V3' },
  { id: 'SS-11', varA: 'session is delayed recall', varB: 'RD weight 2', frameA: 'IF session is delayed recall -> THEN RD weight 2', swappedCondition: 'IF session is fresh recall', expected: 'RD weight 1', distractor: 'RD weight 2', category: 'slot_var_a', min_band: 'V3' },
  { id: 'SS-12', varA: 'pattern under lock', varB: 'excluded from PTI', frameA: 'IF pattern under lock -> THEN excluded from PTI', swappedCondition: 'IF pattern is clear', expected: 'counted in PTI', distractor: 'excluded from PTI', category: 'slot_var_b', min_band: 'V4' },
];

export function slotItemsForBand(band: VocabularyBand, allBands: VocabularyBand[]): SlotItem[] {
  const cap = allBands.indexOf(band);
  return SLOT_ITEMS.filter((p) => allBands.indexOf(p.min_band) <= cap);
}
