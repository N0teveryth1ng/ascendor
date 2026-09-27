/**
 * Audio layer.
 *
 * Two independent capabilities, both required by the spec:
 *   1. AURAL vectors need *delivered* speech at a controlled WPM (C3, P4_AUD).
 *   2. Vocal vectors need *real* microphone capture so the candidate is graded
 *      on a recording, not on a text box (C4, C5, P4_VOC).
 *
 * Every capability degrades to a working fallback rather than blocking.
 */

export type SpeechSupport = 'native' | 'unavailable';

let cachedVoices: SpeechSynthesisVoice[] = [];

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoices = speechSynthesis.getVoices();
  });
  cachedVoices = speechSynthesis.getVoices();
}

export function speechSupport(): SpeechSupport {
  return typeof speechSynthesis !== 'undefined' ? 'native' : 'unavailable';
}

export function micSupport(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Prefers a local en-* voice so latency and rate control stay predictable. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoices.length === 0 && typeof speechSynthesis !== 'undefined') {
    cachedVoices = speechSynthesis.getVoices();
  }
  return (
    cachedVoices.find((v) => v.lang === 'en-US' && v.localService) ??
    cachedVoices.find((v) => v.lang.startsWith('en')) ??
    cachedVoices[0] ??
    null
  );
}

export interface SpeakOptions {
  /** Baseline utterance rate. 1.0 is the voice's natural delivery rate. */
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: (reason: string) => void;
}

/**
 * Speaks `text` and resolves when playback finishes. APE's speed multiplier
 * scales the RATE: tightening must make the candidate faster, so >1 raises it.
 */
export function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (typeof speechSynthesis === 'undefined' || !text.trim()) {
    opts.onError?.('SPEECH UNAVAILABLE');
    opts.onEnd?.();
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-US';
    u.rate = Math.max(0.1, Math.min(10, opts.rate ?? 1));
    u.pitch = opts.pitch ?? 1;
    u.onend = () => {
      opts.onEnd?.();
      resolve();
    };
    u.onerror = (e) => {
      opts.onError?.(e.error || 'SPEECH ERROR');
      opts.onEnd?.();
      resolve();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/** Words-per-minute to a SpeechSynthesis rate multiplier. */
export function rateForWpm(wpm: number, baselineRate = 1): number {
  // A comfortable reference delivery is ~165 wpm at rate 1.0.
  return Math.max(0.1, Math.min(10, baselineRate * (wpm / 165)));
}

export function cancelSpeech(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/* ── Real microphone capture ──────────────────────────────────────────────── */

export interface MicCapture {
  stream: MediaStream;
  stop: () => Promise<Blob | null>;
  /** Peak amplitude observed since the meter was last reset, 0..1. */
  peak: () => number;
  /**
   * Begins a new measurement window. Call this before each recording: a peak is
   * only meaningful for the utterance it was taken from, and a running maximum
   * carries the loudest moment of the whole session into every later item.
   */
  resetPeak: () => void;
}

/**
 * Opens a real microphone stream and starts metering it. Returns null when the
 * device is unavailable or permission is denied — the caller must then fall
 * back rather than block the candidate.
 */
export async function openMic(): Promise<MicCapture | null> {
  if (!micSupport()) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    let peakLevel = 0;
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    let raf = 0;
    if (AudioCtor) {
      ctx = new AudioCtor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        if (peak > peakLevel) peakLevel = peak;
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    return {
      stream,
      peak: () => peakLevel,
      resetPeak: () => {
        peakLevel = 0;
      },
      stop: async () => {
        cancelAnimationFrame(raf);
        for (const t of stream.getTracks()) t.stop();
        if (ctx) await ctx.close().catch(() => undefined);
        if (typeof MediaRecorder === 'undefined') return null;
        // A fresh recorder per capture; the old stream is already stopped.
        return null;
      },
    };
  } catch {
    return null;
  }
}

/** Records `durationMs` of real audio and resolves with the encoded blob. */
export async function recordFor(
  stream: MediaStream,
  durationMs: number,
): Promise<{ blob: Blob | null; peak: number; reason: string | null }> {
  if (typeof MediaRecorder === 'undefined') {
    return { blob: null, peak: 0, reason: 'MEDIARECORDER UNAVAILABLE' };
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(
    (m) => MediaRecorder.isTypeSupported?.(m),
  );
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch {
    return { blob: null, peak: 0, reason: 'MIC ENCODER FAILED' };
  }

  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob | null>((resolve) => {
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null);
    rec.onerror = () => resolve(null);
  });

  let peak = 0;
  const meter = (async () => {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    await new Promise<void>((resolve) => {
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let p = 0;
        for (const v of buf) p = Math.max(p, Math.abs(v - 128) / 128);
        if (p > peak) peak = p;
        requestAnimationFrame(tick);
      };
      tick();
      setTimeout(resolve, durationMs);
    });
    await ctx.close().catch(() => undefined);
  })();

  rec.start();
  await new Promise((r) => setTimeout(r, durationMs));
  if (rec.state !== 'inactive') rec.stop();
  await meter;
  const blob = await done;
  return { blob, peak, reason: blob ? null : 'NO AUDIO CAPTURED' };
}
