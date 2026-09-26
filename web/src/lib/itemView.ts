import type { DrillItem } from '../types';

/**
 * A single rendering description for a drill item.
 *
 * `Onboarding.tsx` and `SessionRunner.tsx` each grew their own inline
 * `switch`/ternary chains for deciding what to display, what to speak, whether
 * a typed answer was expected and whether the microphone was needed. Those two
 * copies were written against a content shape the server does not produce
 * (`aural`, `vocal`, `swap`, `anomaly`, `recall`), so dictation and pressure
 * fell through every branch and rendered as a blank card. `expectedOf` in
 * `grading.ts` had the matching bug and scored them all wrong.
 *
 * Resolving the item to a view model in one exhaustive place means the answer
 * key and the presentation are derived from the same union, and a new kind
 * breaks the build in exactly one file.
 */
export interface ItemView {
  /** The item's identifier, for React keys and attempt records. */
  id: string;
  /** Short label describing the task, shown above the body. */
  prompt: string;
  /** The main content of the item. */
  body: string;
  /** Extra lines rendered under the body, e.g. slot or passage detail. */
  detail?: string;
  /** Choices to present instead of a free-text box, when the item is multiple choice. */
  options?: string[];
  /** Text to speak aloud, when the item is auditory. */
  speech?: { text: string; wpm?: number };
  /** How long the item stays on screen before it is considered late. */
  durationMs: number;
  /** True when the item runs against a hard deadline and auto-commits on expiry. */
  timed: boolean;
  /** True when the candidate answers by reading or recalling, not by typing. */
  inputless: boolean;
  /** True when the candidate answers by speaking, so the mic must record. */
  voice: boolean;
  /** True when the item is a dictation target, so typos count against the score. */
  typoSensitive: boolean;
}

const JOIN = ' · ';

/** Audio dictation reads at a measured rate; everything else at natural pace. */
function rateHint(wpm: number | undefined): number | undefined {
  if (wpm === undefined) return undefined;
  // `speak` expects a multiplier near 1; approximate wpm/165 for a typical voice.
  return Math.max(0.6, Math.min(2, wpm / 165));
}

export function itemView(item: DrillItem): ItemView {
  switch (item.kind) {
    case 'pattern':
      return {
        id: item.item_id,
        prompt: item.prompt,
        body: `${item.pair[0]} / ${item.pair[1]}`,
        detail: item.marker,
        options: item.options,
        durationMs: item.threshold_ms,
        timed: false,
        inputless: false,
        voice: false,
        typoSensitive: false,
      };

    case 'syntax':
      return {
        id: item.item_id,
        prompt: item.construction,
        body: item.scaffold,
        options: item.options,
        durationMs: item.threshold_ms,
        timed: false,
        inputless: false,
        voice: false,
        typoSensitive: false,
      };

    case 'slot':
      return {
        id: item.item_id,
        prompt: 'Slot the second half to match the first.',
        body: item.swapped_condition,
        detail: item.frame_a,
        durationMs: item.swap_interval_ms || item.threshold_ms,
        timed: true,
        inputless: false,
        voice: false,
        typoSensitive: false,
      };

    case 'microtext':
      return {
        id: item.item_id,
        prompt: 'Read it, then type what you remember.',
        body: item.sentences[item.blank_index] ?? item.sentences.join(' '),
        detail: item.steps.find((s) => s.index === item.blank_index)?.node,
        options: item.options,
        durationMs: item.display_ms || item.threshold_ms,
        timed: true,
        inputless: false,
        voice: false,
        typoSensitive: false,
      };

    case 'burst':
      return {
        id: item.item_id,
        prompt: item.group_label,
        body: item.token,
        detail: `${item.repetitions} repetitions`,
        durationMs: item.threshold_ms,
        timed: false,
        inputless: false,
        voice: false,
        typoSensitive: false,
      };

    case 'stream':
      return {
        id: item.item_id,
        prompt: 'Type the stream as you hear it.',
        body: item.tokens.join(JOIN),
        // The token at the anomaly index is the one that must be corrected.
        detail: item.tokens[item.anomaly_index],
        speech: { text: item.tokens.join(' '), wpm: rateHint(item.wpm) },
        durationMs: item.anomaly_window_ms || item.threshold_ms,
        timed: true,
        inputless: false,
        voice: false,
        typoSensitive: item.mode === 'typo',
      };

    case 'dictation':
      return {
        id: item.item_id,
        prompt: 'Type exactly what you hear.',
        body: '',
        speech: { text: item.text },
        durationMs: item.threshold_ms,
        timed: false,
        inputless: false,
        voice: false,
        typoSensitive: true,
      };

    case 'scene':
      return {
        id: item.item_id,
        prompt: `Study this for ${Math.round(item.flash_duration_ms / 1000)} seconds, then recall it.`,
        body: item.slots.map((s) => `${s.slot}. ${s.expected}`).join('\n'),
        detail: item.title,
        durationMs: item.flash_duration_ms,
        timed: true,
        inputless: true,
        voice: true,
        typoSensitive: false,
      };

    case 'read_aloud':
      return {
        id: item.item_id,
        prompt: 'Read this passage aloud.',
        body: item.text,
        detail: item.title,
        durationMs: item.threshold_ms,
        timed: false,
        inputless: true,
        voice: true,
        typoSensitive: false,
      };

    case 'pressure':
      return {
        id: item.item_id,
        prompt: `Type the dictation before the window closes. ${item.visual_cue}`,
        body: item.dictation_text,
        detail: item.stream_tokens.join(JOIN),
        speech: { text: item.dictation_text, wpm: rateHint(item.wpm) },
        // The pressure chamber shortens the window as the chamber escalates.
        durationMs: Math.round(
          item.response_window_ms * (1 - item.window_reduction_pct / 100),
        ),
        timed: true,
        inputless: false,
        voice: false,
        typoSensitive: true,
      };

    default: {
      const exhaustive: never = item;
      throw new Error(`unhandled drill item kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The expected answer for an item, mirroring `expectedOf` in `grading.ts`. */
export function itemAnswer(item: DrillItem): string {
  switch (item.kind) {
    case 'pattern':
    case 'syntax':
    case 'microtext':
    case 'slot':
    case 'stream':
      return item.expected;
    case 'burst':
      return item.token;
    case 'dictation':
    case 'read_aloud':
      return item.text;
    case 'pressure':
      return item.dictation_text;
    case 'scene':
      return '';
    default: {
      const exhaustive: never = item;
      throw new Error(`unhandled drill item kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Candidates whose rate is wide enough to be worth a confidence band. A wide RD
 * means the engine is still learning the level, so the difficulty step between
 * sessions has to be smaller.
 */
export function confidenceBand(rd: number): 'high' | 'medium' | 'low' {
  if (rd < 100) return 'high';
  if (rd <= 200) return 'medium';
  return 'low';
}
