import type { ErrorCategory } from '../core/errorTags.js';
import type { VocabularyBand } from '../core/types.js';

/* ── 7.2.2 Flowchart Comprehension Mapping ────────────────────────────────── */

export interface FlowStep {
  index: number;
  text: string;
  node: string;
}

export interface MicroText {
  id: string;
  min_band: VocabularyBand;
  title: string;
  /** Three-sentence micro-text, displayed for an APE-adjustable duration. */
  sentences: string[];
  steps: FlowStep[];
  /** Index of the step left blank for reconstruction. */
  blank_index: number;
  options: string[];
  expected: string;
  category: ErrorCategory;
  /** Correct chronological order of node labels. */
  correct_order: string[];
}

export const MICROTEXTS: MicroText[] = [
  {
    id: 'MT-01', min_band: 'V1', title: 'DELIVERY FAILURE',
    sentences: [
      'A parcel arrives at the depot at 06:00.',
      'The scanner fails to read the label.',
      'The parcel is routed to the manual queue.',
    ],
    steps: [
      { index: 0, text: 'Parcel arrives at depot', node: 'A' },
      { index: 1, text: 'Scanner fails to read label', node: 'B' },
      { index: 2, text: 'Parcel routed to manual queue', node: 'C' },
      { index: 3, text: 'Supervisor reissues the label', node: 'D' },
    ],
    blank_index: 2,
    options: ['Parcel routed to manual queue', 'Supervisor reissues the label', 'Scanner fails to read label', 'Parcel arrives at depot'],
    expected: 'Parcel routed to manual queue',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-02', min_band: 'V2', title: 'AUTH RETRY',
    sentences: [
      'A login attempt is submitted at 14:20.',
      'The token has already expired.',
      'The system issues a fresh token and retries once.',
    ],
    steps: [
      { index: 0, text: 'Login attempt submitted', node: 'A' },
      { index: 1, text: 'Token detected as expired', node: 'B' },
      { index: 2, text: 'Fresh token issued', node: 'C' },
      { index: 3, text: 'Request retried once', node: 'D' },
    ],
    blank_index: 3,
    options: ['Request retried once', 'Login attempt submitted', 'Fresh token issued', 'Token detected as expired'],
    expected: 'Request retried once',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-03', min_band: 'V2', title: 'BATCH RECONCILIATION',
    sentences: [
      'Nightly totals are compared against the ledger.',
      'A discrepancy of 0.40 is detected.',
      'The batch is held for review rather than posted.',
    ],
    steps: [
      { index: 0, text: 'Totals compared to ledger', node: 'A' },
      { index: 1, text: 'Discrepancy of 0.40 detected', node: 'B' },
      { index: 2, text: 'Batch held for review', node: 'C' },
      { index: 3, text: 'Supervisor approves posting', node: 'D' },
    ],
    blank_index: 1,
    options: ['Discrepancy of 0.40 detected', 'Batch held for review', 'Totals compared to ledger', 'Supervisor approves posting'],
    expected: 'Discrepancy of 0.40 detected',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-04', min_band: 'V3', title: 'SENSOR FAULT',
    sentences: [
      'The transducer reports a flat line for 4 seconds.',
      'The reading falls outside the plausible range.',
      'The sample is flagged and the pass is repeated.',
    ],
    steps: [
      { index: 0, text: 'Transducer reports flat line', node: 'A' },
      { index: 1, text: 'Reading outside plausible range', node: 'B' },
      { index: 2, text: 'Sample flagged', node: 'C' },
      { index: 3, text: 'Calibration pass repeated', node: 'D' },
    ],
    blank_index: 2,
    options: ['Sample flagged', 'Transducer reports flat line', 'Calibration pass repeated', 'Reading outside plausible range'],
    expected: 'Sample flagged',
    category: 'anomaly_detection',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-05', min_band: 'V3', title: 'SHIFT HANDOVER',
    sentences: [
      'The outgoing lead logs two open faults.',
      'The incoming lead verifies the panel state.',
      'Both signatures are recorded before departure.',
    ],
    steps: [
      { index: 0, text: 'Outgoing lead logs two faults', node: 'A' },
      { index: 1, text: 'Incoming lead verifies panel', node: 'B' },
      { index: 2, text: 'Both signatures recorded', node: 'C' },
      { index: 3, text: 'Departure logged at the gate', node: 'D' },
    ],
    blank_index: 1,
    options: ['Incoming lead verifies panel', 'Both signatures recorded', 'Outgoing lead logs two faults', 'Departure logged at the gate'],
    expected: 'Incoming lead verifies panel',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-06', min_band: 'V4', title: 'CONTRACT RENEWAL',
    sentences: [
      'The agreement expires at the end of the quarter.',
      'Either party may decline renewal in writing.',
      'Without notice, the terms carry over unchanged.',
    ],
    steps: [
      { index: 0, text: 'Agreement approaches expiry', node: 'A' },
      { index: 1, text: 'Renewal window opens', node: 'B' },
      { index: 2, text: 'Either party declines in writing', node: 'C' },
      { index: 3, text: 'Terms carry over unchanged', node: 'D' },
    ],
    blank_index: 2,
    options: ['Either party declines in writing', 'Terms carry over unchanged', 'Agreement approaches expiry', 'Renewal window opens'],
    expected: 'Either party declines in writing',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-07', min_band: 'V4', title: 'LAB SAMPLE CHAIN',
    sentences: [
      'A sample is drawn and labelled at 09:15.',
      'The courier records a seal discrepancy.',
      'The sample is rejected and redrawn.',
    ],
    steps: [
      { index: 0, text: 'Sample drawn and labelled', node: 'A' },
      { index: 1, text: 'Seal discrepancy recorded', node: 'B' },
      { index: 2, text: 'Sample rejected', node: 'C' },
      { index: 3, text: 'Replacement sample drawn', node: 'D' },
    ],
    blank_index: 3,
    options: ['Replacement sample drawn', 'Sample rejected', 'Seal discrepancy recorded', 'Sample drawn and labelled'],
    expected: 'Replacement sample drawn',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-08', min_band: 'V5', title: 'GRID RESTRAINT',
    sentences: [
      'Load exceeds the contracted ceiling for two intervals.',
      'The operator issues a curtailment instruction.',
      'Load returns to within tolerance by the third interval.',
    ],
    steps: [
      { index: 0, text: 'Load exceeds ceiling', node: 'A' },
      { index: 1, text: 'Curtailment instruction issued', node: 'B' },
      { index: 2, text: 'Load monitored for two intervals', node: 'C' },
      { index: 3, text: 'Load returns within tolerance', node: 'D' },
    ],
    blank_index: 2,
    options: ['Load monitored for two intervals', 'Load exceeds ceiling', 'Load returns within tolerance', 'Curtailment instruction issued'],
    expected: 'Load monitored for two intervals',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-09', min_band: 'V5', title: 'ARCHIVE RESTRICTION',
    sentences: [
      'A request cites a record closed in 1998.',
      'The archive rule bars disclosure for a further 12 months.',
      'The requester is notified of the review date.',
    ],
    steps: [
      { index: 0, text: 'Request cites closed record', node: 'A' },
      { index: 1, text: 'Disclosure bar invoked', node: 'B' },
      { index: 2, text: 'Review date set 12 months out', node: 'C' },
      { index: 3, text: 'Requester notified', node: 'D' },
    ],
    blank_index: 1,
    options: ['Disclosure bar invoked', 'Requester notified', 'Review date set 12 months out', 'Request cites closed record'],
    expected: 'Disclosure bar invoked',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
  {
    id: 'MT-10', min_band: 'V6', title: 'CAPACITY EXCEEDANCE',
    sentences: [
      'Sustained throughput exceeds the provisioned ceiling.',
      'Backlog depth crosses the alert threshold.',
      'Traffic is shed from non-critical routes.',
    ],
    steps: [
      { index: 0, text: 'Throughput exceeds ceiling', node: 'A' },
      { index: 1, text: 'Backlog crosses alert threshold', node: 'B' },
      { index: 2, text: 'Non-critical routes shed', node: 'C' },
      { index: 3, text: 'Backlog drains to baseline', node: 'D' },
    ],
    blank_index: 2,
    options: ['Non-critical routes shed', 'Backlog drains to baseline', 'Throughput exceeds ceiling', 'Backlog crosses alert threshold'],
    expected: 'Non-critical routes shed',
    category: 'sequence_ordering',
    correct_order: ['A', 'B', 'C', 'D'],
  },
];

/* ── 7.3.2 High-Velocity Stream Processing ────────────────────────────────── */

export interface StreamItem {
  id: string;
  min_band: VocabularyBand;
  /** Base text as a token stream, delivered at the APE-set WPM. */
  tokens: string[];
  /** Index of the anomalous token. */
  anomaly_index: number;
  anomaly_token: string;
  category: ErrorCategory;
  /** What the token should have been. */
  corrected: string;
  note: string;
}

export const STREAMS: StreamItem[] = [
  { id: 'ST-01', min_band: 'V1', tokens: ['the', 'pace', 'engine', 'holds', 'the', 'factor', 'at', 'one', 'point', 'oh', 'oh', 'for', 'this', 'module'], anomaly_index: 9, anomaly_token: 'oh', category: 'anomaly_detection', corrected: 'zero', note: 'numeral token corrupted' },
  { id: 'ST-02', min_band: 'V1', tokens: ['accuracy', 'rose', 'three', 'steps', 'so', 'the', 'threshold', 'was', 'tightened', 'tightened', 'again'], anomaly_index: 9, anomaly_token: 'tightened', category: 'anomaly_detection', corrected: 'loosened', note: 'token repeated with inversion' },
  { id: 'ST-03', min_band: 'V2', tokens: ['the', 'lock', 'diverts', 'fifteen', 'percent', 'of', 'sessions', 'until', 'recurrence', 'drops', 'below', 'two'], anomaly_index: 3, anomaly_token: 'fifteen', category: 'anomaly_detection', corrected: 'ten', note: 'quantity out of spec' },
  { id: 'ST-04', min_band: 'V2', tokens: ['rank', 'zero', 'zero', 'requires', 'a', 'thirty', 'day', 'rolling', 'window', 'not', 'a', 'single', 'test'], anomaly_index: 1, anomaly_token: 'zero', category: 'anomaly_detection', corrected: 'two', note: 'duplicate numeral' },
  { id: 'ST-05', min_band: 'V3', tokens: ['baseline', 'stats', 'are', 'immutable', 'downward', 'except', 'through', 'sustained', 'degradation', 'degradation', 'of', 'three', 'sessions'], anomaly_index: 9, anomaly_token: 'degradation', category: 'anomaly_detection', corrected: 'accuracy', note: 'token duplicated' },
  { id: 'ST-06', min_band: 'V3', tokens: ['the', 'pressure', 'chamber', 'stops', 'reducing', 'its', 'window', 'when', 'rolling', 'accuracy', 'falls', 'under', 'ninety', 'eight'], anomaly_index: 13, anomaly_token: 'eight', category: 'anomaly_detection', corrected: 'ninety', note: 'numeral inverted' },
  { id: 'ST-07', min_band: 'V4', tokens: ['escalation', 'requires', 'three', 'consecutive', 'sessions', 'inside', 'the', 'target', 'band', 'and', 'no', 'active', 'lock'], anomaly_index: 6, anomaly_token: 'the', category: 'anomaly_detection', corrected: 'any', note: 'determiner swapped' },
  { id: 'ST-08', min_band: 'V4', tokens: ['delayed', 'recall', 'carries', 'twice', 'the', 'weight', 'of', 'fresh', 'recall', 'because', 'it', 'measures', 'retention'], anomaly_index: 3, anomaly_token: 'twice', category: 'anomaly_detection', corrected: 'three', note: 'weight value altered' },
  { id: 'ST-09', min_band: 'V5', tokens: ['a', 'structural', 'lock', 'caps', 'escalation', 'on', 'one', 'vector', 'without', 'halting', 'overall', 'progression'], anomaly_index: 6, anomaly_token: 'one', category: 'anomaly_detection', corrected: 'every', note: 'quantifier narrowed' },
  { id: 'ST-10', min_band: 'V5', tokens: ['streak', 'multiplier', 'resets', 'on', 'failure', 'and', 'access', 'is', 'never', 'revoked', 'revoked', 'not', 'once'], anomaly_index: 10, anomaly_token: 'revoked', category: 'anomaly_detection', corrected: 'restored', note: 'token duplicated with inversion' },
  { id: 'ST-11', min_band: 'V6', tokens: ['the', 'clamp', 'prevents', 'the', 'threshold', 'collapsing', 'below', 'the', 'statistical', 'floor', 'floor', 'at', 'six', 'hundred', 'ms'], anomaly_index: 10, anomaly_token: 'floor', category: 'anomaly_detection', corrected: 'ceiling', note: 'terminology inverted' },
  { id: 'ST-12', min_band: 'V6', tokens: ['pattern', 'intuition', 'excludes', 'locked', 'patterns', 'so', 'one', 'gap', 'does', 'not', 'mask', 'genuine', 'progress'], anomaly_index: 4, anomaly_token: 'patterns', category: 'anomaly_detection', corrected: 'pattern', note: 'plural form injected' },
];

export function streamsForBand(band: VocabularyBand, allBands: VocabularyBand[]): StreamItem[] {
  const cap = allBands.indexOf(band);
  return STREAMS.filter((s) => allBands.indexOf(s.min_band) <= cap);
}
