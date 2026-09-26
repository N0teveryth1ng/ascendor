/**
 * Section 13.2 copy for the calibration wizard. The battery itself (manifest,
 * thresholds, derivation) is untouched and still lives in core/calibration.ts;
 * this is display text only.
 */
export const CALIBRATION_STEP_COPY: {
  key: string;
  step: number;
  title: string;
  blurb: string;
  prompt: string;
  pass_note: string;
}[] = [
  {
    key: 'C1',
    step: 1,
    title: 'Vocabulary Check',
    blurb: 'We will see which word levels feel comfortable.',
    prompt: 'Type each word you hear. Take your time — speed comes later.',
    pass_note: 'Now the same set again, this time at speed.',
  },
  {
    key: 'C2',
    step: 2,
    title: 'Sentence Complexity',
    blurb: 'We will see how complex a sentence you can handle.',
    prompt: 'Fix the sentence so it reads correctly. Take your time.',
    pass_note: 'Now the same set again, this time at speed.',
  },
  {
    key: 'C3',
    step: 3,
    title: 'Reading Speed',
    blurb: 'We will find the pace that feels right.',
    prompt: 'Listen and type what you hear. Take your time.',
    pass_note: 'Now the same set again, this time at speed.',
  },
  {
    key: 'C4',
    step: 4,
    title: 'Speaking Clarity',
    blurb: 'We will check how clearly your words come through.',
    prompt: 'Read each line out loud so we can hear how clear it is.',
    pass_note: 'Now the same set again, this time at speed.',
  },
  {
    key: 'C5',
    step: 5,
    title: 'Short-Term Recall',
    blurb: 'We will see how much you remember moments later.',
    prompt: 'Write down as many words as you can from the set. Take your time.',
    pass_note: 'Now the same set again, this time at speed.',
  },
];

export const CALIBRATION_MANIFEST = { version: '1.0.0' };

export const ONBOARDING_COPY = {
  title: "Let's set up your profile",
  blurb: 'Five short steps, about ten minutes. No grades, no timer on the first pass — this is just so the app knows where to start you.',
  cta: 'Get started',
  signed_in: 'Signed in',
};
