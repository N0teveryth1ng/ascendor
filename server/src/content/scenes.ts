import type { VocabularyBand } from '../core/types.js';

/**
 * 7.1.2 Visuo-Spatial Flash. A multi-action scene is flashed for an
 * APE-adjustable duration (1200-2500ms) and reconstructed from memory.
 * The same scene is re-presented in the next day's session to measure
 * 24h retention, which is what RD actually weights.
 */

export interface SceneAction {
  slot: number;
  actor: string;
  verb: string;
  object: string;
  /** Marker tying the action to a spatial relation. */
  spatial: string;
}

export interface Scene {
  id: string;
  min_band: VocabularyBand;
  title: string;
  actions: SceneAction[];
  /** Plausible but absent elements, used as distractor options. */
  distractors: string[];
}

export const SCENES: Scene[] = [
  {
    id: 'SC-01', min_band: 'V1', title: 'LOADING BAY',
    actions: [
      { slot: 1, actor: 'an operator', verb: 'unloads', object: 'three crates', spatial: 'from the left bay' },
      { slot: 2, actor: 'a supervisor', verb: 'inspects', object: 'the manifest', spatial: 'beside the second crate' },
      { slot: 3, actor: 'a forklift', verb: 'lifts', object: 'a pallet', spatial: 'above the loading ramp' },
    ],
    distractors: ['a courier signs the manifest', 'a crane lowers the ramp', 'two inspectors unload a pallet'],
  },
  {
    id: 'SC-02', min_band: 'V1', title: 'CONTROL ROOM',
    actions: [
      { slot: 1, actor: 'a technician', verb: 'aligns', object: 'three monitors', spatial: 'along the far wall' },
      { slot: 2, actor: 'the shift lead', verb: 'records', object: 'a latency spike', spatial: 'in the second monitor' },
      { slot: 3, actor: 'an engineer', verb: 'reroutes', object: 'the audio feed', spatial: 'under the console' },
    ],
    distractors: ['the shift lead erases the spike', 'a technician lowers the console', 'an engineer signs three monitors'],
  },
  {
    id: 'SC-03', min_band: 'V2', title: 'SORTING FLOOR',
    actions: [
      { slot: 1, actor: 'a sorter', verb: 'separates', object: 'nine envelopes', spatial: 'into two trays' },
      { slot: 2, actor: 'a runner', verb: 'carries', object: 'the left tray', spatial: 'toward the north door' },
      { slot: 3, actor: 'a clerk', verb: 'stamps', object: 'each envelope', spatial: 'at the sorting desk' },
    ],
    distractors: ['a sorter stamps each tray', 'a runner separates nine envelopes', 'a clerk carries the north door'],
  },
  {
    id: 'SC-04', min_band: 'V2', title: 'SERVER AISLE',
    actions: [
      { slot: 1, actor: 'an operator', verb: 'removes', object: 'two blades', spatial: 'from the fourth rack' },
      { slot: 2, actor: 'a logger', verb: 'prints', object: 'a fault code', spatial: 'beside the cabinet' },
      { slot: 3, actor: 'a second operator', verb: 'replaces', object: 'the blades', spatial: 'before the cooling cycle ends' },
    ],
    distractors: ['the logger prints two blades', 'an operator removes the cooling cycle', 'a second operator prints a fault code'],
  },
  {
    id: 'SC-05', min_band: 'V3', title: 'PRINT FLOOR',
    actions: [
      { slot: 1, actor: 'an operator', verb: 'feeds', object: 'a ream of paper', spatial: 'into the top tray' },
      { slot: 2, actor: 'the press', verb: 'emits', object: 'four sheets', spatial: 'per cycle' },
      { slot: 3, actor: 'an inspector', verb: 'rejects', object: 'one sheet', spatial: 'at the output belt' },
      { slot: 4, actor: 'a second operator', verb: 'counts', object: 'the accepted sheets', spatial: 'near the exit' },
    ],
    distractors: ['the press rejects four sheets', 'an inspector feeds a ream', 'a second operator emits one sheet'],
  },
  {
    id: 'SC-06', min_band: 'V3', title: 'ARCHIVE STACKS',
    actions: [
      { slot: 1, actor: 'an archivist', verb: 'climbs', object: 'the third ladder', spatial: 'at the north stack' },
      { slot: 2, actor: 'a second archivist', verb: 'passes', object: 'a ledger', spatial: 'downward' },
      { slot: 3, actor: 'the first archivist', verb: 'files', object: 'the ledger', spatial: 'on the top shelf' },
      { slot: 4, actor: 'a clerk', verb: 'logs', object: 'the request', spatial: 'at the desk' },
    ],
    distractors: ['an archivist logs the top shelf', 'a clerk climbs the request', 'the first archivist passes the desk'],
  },
  {
    id: 'SC-07', min_band: 'V4', title: 'CUSTOMS HALL',
    actions: [
      { slot: 1, actor: 'an officer', verb: 'stamps', object: 'four declarations', spatial: 'at the west counter' },
      { slot: 2, actor: 'a courier', verb: 'presents', object: 'a single permit', spatial: 'across the counter' },
      { slot: 3, actor: 'the officer', verb: 'compares', object: 'the permit', spatial: 'against the manifest' },
      { slot: 4, actor: 'a supervisor', verb: 'releases', object: 'the third crate', spatial: 'to the south lane' },
    ],
    distractors: ['a courier stamps four declarations', 'a supervisor presents the west counter', 'an officer releases the manifest'],
  },
  {
    id: 'SC-08', min_band: 'V4', title: 'CALIBRATION LAB',
    actions: [
      { slot: 1, actor: 'a technician', verb: 'calibrates', object: 'the third transducer', spatial: 'on the left bench' },
      { slot: 2, actor: 'an observer', verb: 'notes', object: 'two substitutions', spatial: 'on the clipboard' },
      { slot: 3, actor: 'the technician', verb: 'reruns', object: 'the aural ladder', spatial: 'at 90 words per minute' },
      { slot: 4, actor: 'a supervisor', verb: 'locks', object: 'the profile', spatial: 'after both passes' },
    ],
    distractors: ['a supervisor calibrates the clipboard', 'the technician notes the transducer', 'an observer reruns two substitutions'],
  },
  {
    id: 'SC-09', min_band: 'V5', title: 'POWER SUBSTATION',
    actions: [
      { slot: 1, actor: 'a grid operator', verb: 'closes', object: 'the second breaker', spatial: 'at the north panel' },
      { slot: 2, actor: 'a relay', verb: 'trips', object: 'once', spatial: 'during the switchover' },
      { slot: 3, actor: 'the operator', verb: 'isolates', object: 'the faulted bus', spatial: 'downstream' },
      { slot: 4, actor: 'an inspector', verb: 'certifies', object: 'the insulation', spatial: 'before re-energizing' },
    ],
    distractors: ['a relay certifies the breaker', 'an inspector closes the north panel', 'the operator isolates once'],
  },
  {
    id: 'SC-10', min_band: 'V5', title: 'TRANSIT DEPOT',
    actions: [
      { slot: 1, actor: 'a dispatcher', verb: 'assigns', object: 'two drivers', spatial: 'to the west route' },
      { slot: 2, actor: 'the first driver', verb: 'loads', object: 'four crates', spatial: 'into vehicle twelve' },
      { slot: 3, actor: 'a second dispatcher', verb: 'reassigns', object: 'the second driver', spatial: 'to the north route' },
      { slot: 4, actor: 'a clerk', verb: 'stamps', object: 'both manifests', spatial: 'at the window' },
    ],
    distractors: ['a driver assigns the west route', 'the dispatcher stamps two drivers', 'a clerk loads vehicle twelve'],
  },
];

export function scenesForBand(band: VocabularyBand, allBands: VocabularyBand[]): Scene[] {
  const cap = allBands.indexOf(band);
  return SCENES.filter((s) => allBands.indexOf(s.min_band) <= cap);
}

/** Expected reconstruction for slot n, in compact form. */
export function expectedActionText(a: SceneAction): string {
  return `${a.actor} ${a.verb} ${a.object} ${a.spatial}`.replace(/\s+/g, ' ').trim();
}
