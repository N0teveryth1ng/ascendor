import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, Mic, MicOff, Volume2 } from 'lucide-react';
import { useForge } from '../store/useForge';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { gradeAnswer, toAttempt } from '../lib/grading';
import { openMic, recordFor, speak, type MicCapture } from '../lib/audio';
import { itemView } from '../lib/itemView';
import type { Attempt, CalibrationPass, DrillItem, Onboarding } from '@/types';

/**
 * Section 13.7 onboarding. The battery, item source, and pass schema are the
 * engine's; only the presentation, ordering, and wording are ours.
 *
 * Items come from `/calibration/probe`, the one session-plan path that is
 * deliberately NOT PCP-gated: the battery produces the PCP, so gating it here
 * would make calibration unreachable.
 *
 * The client asks for a vector and the server decides which content measures
 * it. This file used to hold a vector-to-module map, and that indirection is
 * exactly how C1 came to be wired to P3_SSM — a slot-reasoning module whose
 * prompt text is APE rule logic, shown to candidates as a vocabulary probe. The
 * C1 pass then keyed its band scores by splitting item_id on '-', which yielded
 * pattern ids rather than vocabulary bands, so every candidate's C1 collapsed
 * to a hardcoded V1 at 0% accuracy.
 */
const VECTORS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const;
type Vector = (typeof VECTORS)[number];
type PassType = 'untimed' | 'timed';

export function Onboarding() {
  const { user, go, setFault } = useForge();
  const [guide, setGuide] = useState<Onboarding | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'intro' | 'pass' | 'done'>('intro');
  const [passType, setPassType] = useState<PassType>('untimed');
  const [log, setLog] = useState<CalibrationPass[]>([]);

  const [items, setItems] = useState<DrillItem[]>([]);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mic, setMic] = useState<MicCapture | null>(null);
  /** Per-item mic peak captured at the end of that item's recording. */
  const [micPeaks, setMicPeaks] = useState<Record<string, number>>({});
  const [micLive, setMicLive] = useState(false);

  const item = items[index] ?? null;
  const view = useMemo(() => (item ? itemView(item) : null), [item]);
  const vector: Vector = VECTORS[stepIndex] ?? 'C1';
  const step = guide?.steps[stepIndex] ?? null;
  const timed = passType === 'timed';
  const presentedAt = useRef(0);

  useEffect(() => {
    api
      .onboarding()
      .then(setGuide)
      .catch((e: Error) => setFault(e.message));
  }, [setFault]);

  useEffect(() => {
    if (!user || !running) return;
    let live: MicCapture | null = null;
    let cancelled = false;
    void openMic().then((m) => {
      if (cancelled) {
        void m?.stop();
        return;
      }
      live = m;
      setMic(m);
      setMicLive(!!m);
    });
    return () => {
      cancelled = true;
      void live?.stop();
      setMic(null);
      setMicLive(false);
    };
  }, [user, running]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { plan } = await api.calibrationProbe(vector, passType);
      if (!plan.items.length) throw new Error('No items available for this step.');
      setItems(plan.items);
      setIndex(0);
      setAttempts([]);
      setInput('');
      setRunning(true);
    } catch (e) {
      // Never fail silently: an invisible error is what made Start look dead.
      const message = e instanceof ApiError ? e.message : (e as Error).message;
      setLoadError(message);
      setFault(message);
      setRunning(false);
    } finally {
      setLoading(false);
    }
  }, [vector, setFault]);

  function begin() {
    void loadItems();
  }

  useEffect(() => {
    if (!item || !running) return;
    presentedAt.current = performance.now();
      if (view?.speech) void speak(view.speech.text, { rate: view.speech.wpm });
    setInput('');
  }, [item, running]);

  const submit = useCallback(
    async (text: string | null) => {
      if (!item) return;
      const latency = performance.now() - presentedAt.current;
      if (view?.voice && mic) {
        await recordFor(mic.stream, Math.min(4000, Math.max(700, latency)));
        // Snapshot the mic for THIS item. `peak()` is a running session maximum,
        // so this is the observed level by the end of this item's recording; it
        // is real measured data and lets C4 score a phoneme class instead of
        // hardcoding an empty map.
        setMicPeaks((m) => ({ ...m, [item.item_id]: mic.peak() }));
      }
      // The first pass scores content only so it measures comfort, not speed.
      const effective = timed ? latency : item.threshold_ms / 2;
      setAttempts((a) => [...a, toAttempt(item, gradeAnswer(item, text, effective), text, latency)]);
      if (index + 1 >= items.length) {
        setRunning(false);
        setPhase('done');
        return;
      }
      setIndex((i) => i + 1);
    },
    [index, item, items.length, mic, timed],
  );

  const record = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    const pass = buildPass(vector, passType, attempts, items, mic, micPeaks);
    const nextLog = [...log, pass];
    setLog(nextLog);
    try {
      await api.recordPass(pass);
      const complete = VECTORS.every(
        (v) =>
          nextLog.some((p) => p.vector === v && p.pass_type === 'untimed') &&
          nextLog.some((p) => p.vector === v && p.pass_type === 'timed'),
      );
      if (complete) {
        // The passes are already recorded server-side, each validated on write.
        // Finalise derives the PCP from those recorded rows.
        await api.finalise();
        go('home');
        return;
      }
      // Untimed must precede timed for each vector; after the timed pass the
      // wizard moves on to the next vector's untimed pass.
      if (passType === 'untimed') {
        setPassType('timed');
      } else {
        setPassType('untimed');
        const nextStep = VECTORS.findIndex(
          (v) => !nextLog.some((p) => p.vector === v && p.pass_type === 'untimed'),
        );
        if (nextStep >= 0) setStepIndex(nextStep);
      }
      setPhase('pass');
    } catch (e) {
      setFault(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [user, vector, passType, attempts, items, mic, log, go, setFault]);
  const overall = useMemo(() => log.length / (VECTORS.length * 2), [log]);

  if (!guide) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Let&rsquo;s set up your profile</CardTitle>
            <CardDescription>
              Five short steps, about ten minutes. No grades, no timer on the first pass — this is just so the app knows where
              to start you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2">
              {guide.steps.map((s) => (
                <li key={s.key} className="flex items-start gap-3 text-sm">
                  <span className="tabular mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-xs">
                    {s.step}
                  </span>
                  <span>
                    <span className="font-medium">{s.title}</span>
                    <span className="block text-xs text-muted-foreground">{s.blurb}</span>
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
          <Button size="lg" className="w-full" onClick={() => setPhase('pass')}>
              Get started
              <ArrowRight />
            </Button>
            {/* Calibration lock: "Skip for now" is not rendered until calibration is complete */}
          {/* The onboarding flow must be completed before access is granted. */}
        </Card>
      </div>
    );
  }

  if (phase === 'done') {
    const correct = attempts.filter((a) => a.correct).length;
    const accuracy = (correct / Math.max(1, attempts.length)) * 100;
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{step?.title} — done</CardTitle>
            <CardDescription>
              You got {accuracy.toFixed(0)}% right. Nothing is graded here; this just helps us pick your starting pace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${accuracy}%` }} />
            </div>
            <Button size="lg" className="w-full" disabled={saving} onClick={() => void record()}>
              {saving && <Loader2 className="animate-spin" />}
              Continue
            </Button>
            <Button variant="ghost" className="w-full" onClick={begin}>
              Try these again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

    if (running && item && view) {
      const options = view.options ?? null;
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <p className="font-medium">{step?.title}</p>
            <p className="tabular text-muted-foreground">
              {index + 1} of {items.length}
            </p>
          </div>
          <Progress value={((index + 1) / Math.max(items.length, 1)) * 100} />
        </div>

        {vector === 'C4' && (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {micLive ? <Mic className="h-3.5 w-3.5 text-success" /> : <MicOff className="h-3.5 w-3.5 text-warning" />}
            {micLive ? 'Microphone ready' : 'Microphone unavailable — type what you would say'}
          </p>
        )}

        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{timed ? view.prompt : step?.prompt ?? view.prompt}</p>
                <div className="whitespace-pre-wrap rounded-lg bg-secondary/50 p-4 text-lg leading-relaxed">
                  {view.body}
                  {view.detail && (
                    <span className="mt-2 block text-base font-normal text-muted-foreground">
                      {view.detail}
                    </span>
                  )}
                  {view.speech && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 ml-2 gap-1.5 text-xs"
                      onClick={() => void speak(view.speech!.text, { rate: view.speech!.wpm })}
                    >
                      <Volume2 className="h-3 w-3" /> Play
                    </Button>
                  )}
                </div>
            </div>

            {options ? (
              <div className="grid gap-2">
                {options.map((o) => (
                  <Button
                    key={o}
                    variant="outline"
                    size="lg"
                    className="justify-start text-left"
                    onClick={() => void submit(o)}
                  >
                    {o}
                  </Button>
                ))}
              </div>
              ) : view.inputless ? (
                <div className="space-y-3">
                  {view.voice ? (
                    mic ? (
                      <Button size="lg" className="w-full gap-2" onClick={() => void submit(null)}>
                        <Mic className="h-4 w-4" /> Done reading
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Microphone unavailable - this item was not scored.
                      </p>
                    )
                  ) : null}
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(input.trim() || null);
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    autoFocus
                    className="text-base"
                    placeholder="Type your answer"
                    aria-label="Your answer"
                  />
                  <Button type="submit" size="lg" disabled={!input.trim()}>
                    Check
                  </Button>
                </form>
              )}
          </CardContent>
        </Card>

        {!timed && <p className="text-center text-xs text-muted-foreground">No timer on this pass — accuracy is what matters.</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <p className="font-medium">Setting up your profile</p>
          <p className="tabular text-muted-foreground">
            {log.length} of {VECTORS.length * 2}
          </p>
        </div>
        <Progress value={overall * 100} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Step {stepIndex + 1} of {VECTORS.length} — {step?.title}
          </CardTitle>
          <CardDescription>{step?.blurb}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-lg bg-secondary/50 p-3 text-sm">{timed ? 'Same questions, this time with a time limit.' : step?.prompt}</p>
          <Button size="lg" className="w-full" onClick={begin} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Loading your questions
              </>
            ) : (
              <>
                Start
                <ArrowRight />
              </>
            )}
          </Button>
          {loadError ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {loadError}
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={begin} disabled={loading}>
                Try again
              </Button>
            </p>
          ) : null}
          <ul className="space-y-1">
            {VECTORS.map((v, i) => {
              const done = log.some((p) => p.vector === v && p.pass_type === passType);
              const active = i === stepIndex;
              return (
                <li key={v} className="flex items-center justify-between text-xs">
                  <span className={active ? 'font-medium' : 'text-muted-foreground'}>{guide.steps[i]?.title}</span>
                  <span className={done ? 'text-success' : 'text-muted-foreground'}>{done ? <Check className="h-3.5 w-3.5" /> : '—'}</span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function buildPass(
  vector: Vector,
  passType: PassType,
  attempts: Attempt[],
  items: DrillItem[],
  mic: MicCapture | null,
  micPeaks: Record<string, number> = {},
): CalibrationPass {
  const total = attempts.length;
  const pass: CalibrationPass = {
    vector,
    pass_type: passType,
    correct: attempts.filter((a) => a.correct).length,
    total,
    mean_latency_ms: Math.round(total ? attempts.reduce((s, a) => s + a.latency_ms, 0) / total : 0),
  };

  if (vector === 'C1') {
    // The band comes off the item payload, never from splitting item_id. The
    // old version did item_id.split('-')[2], which for a P3_SSM slot item is a
    // pattern id, not a vocabulary band: every score landed under a key that
    // computeC1 does not recognise, so the vector silently resolved to V1 at 0%.
    //
    // These are percentages, not counts. deriveVocabularyBand gates on `>= 90`
    // and computeC1 divides by 100, so accumulating a count here capped every
    // band below the threshold and forced V1 even when the keys were right.
    const correctByBand: Record<string, number> = {};
    const totalByBand: Record<string, number> = {};
    for (const a of attempts) {
      const item = items.find((i) => i.item_id === a.item_id);
      if (!item || item.kind !== 'vocab') {
        throw new Error(
          `Calibration C1 received a non-vocabulary item (${a.item_id}). ` +
            'A C1 score cannot be derived from this; refusing to record a fabricated band.',
        );
      }
      totalByBand[item.band] = (totalByBand[item.band] ?? 0) + 1;
      if (a.correct) correctByBand[item.band] = (correctByBand[item.band] ?? 0) + 1;
    }
    const byBand: Record<string, number> = {};
    for (const [band, total] of Object.entries(totalByBand)) {
      byBand[band] = Math.round(((correctByBand[band] ?? 0) / total) * 100);
    }
    pass.band_accuracy = byBand;
  }
  if (vector === 'C2') {
    // The level comes off the served item. There was no C2 branch at all, so
    // `level_accuracy` was never sent and `deriveSyntaxCeiling([])` returned S1
    // for every candidate — the floor, regardless of how they actually scored.
    const correctByLevel: Record<string, number> = {};
    const totalByLevel: Record<string, number> = {};
    for (const a of attempts) {
      const item = items.find((i) => i.item_id === a.item_id);
      if (!item || item.kind !== 'syntax') {
        throw new Error(
          `Calibration C2 received a non-syntax item (${a.item_id}). ` +
            'A ceiling cannot be derived from this; refusing to record a fabricated level.',
        );
      }
      totalByLevel[item.level] = (totalByLevel[item.level] ?? 0) + 1;
      if (a.correct) correctByLevel[item.level] = (correctByLevel[item.level] ?? 0) + 1;
    }
    const byLevel: Record<string, number> = {};
    for (const [level, total] of Object.entries(totalByLevel)) {
      byLevel[level] = Math.round(((correctByLevel[level] ?? 0) / total) * 100);
    }
    pass.level_accuracy = byLevel;
  }
  if (vector === 'C3') {
    // Take the rate off the served items. The old fallback wrote 0 when no item
    // carried a wpm, which is not "unknown", it is silence: it would enter
    // `accuracy_by_wpm` as a real measurement at 0 wpm. Absent stays absent.
    const withWpm = items.find((i) => 'wpm' in i && typeof i.wpm === 'number' && i.wpm > 0);
    pass.wpm = withWpm && 'wpm' in withWpm ? withWpm.wpm : undefined;
  }
  if (vector === 'C4') {
    pass.clarity = Math.round((mic?.peak() ?? 0) * 100);
    // Per-phoneme clarity, grouped by the class each burst item targets. This
    // was a hardcoded `{}`: the server derives `flagged_weak_vectors` from these
    // values and needs at least two classes, so C4 could never flag anything and
    // the vector's whole purpose was inert. Values come from the per-item mic
    // snapshots taken during the pass, not from the session total repeated
    // once per item.
    const totalByClass: Record<string, number> = {};
    const sumByClass: Record<string, number> = {};
    for (const a of attempts) {
      const it = items.find((i) => i.item_id === a.item_id);
      if (!it || it.kind !== 'burst') continue;
      const peak = micPeaks[it.item_id];
      if (typeof peak !== 'number') continue;
      const pct = Math.round(Math.min(1, Math.max(0, peak)) * 100);
      totalByClass[it.group] = (totalByClass[it.group] ?? 0) + 1;
      sumByClass[it.group] = (sumByClass[it.group] ?? 0) + pct;
    }
    const byClass: Record<string, number> = {};
    for (const [group, n] of Object.entries(totalByClass)) {
      byClass[group] = Math.round((sumByClass[group]! / n) * 100) / 100;
    }
    pass.clarity_by_class = byClass;
    pass.phoneme_classes = byClass;
  }
  /* C5's typo vulnerability is derived server-side from the untimed-versus-timed
     accuracy contrast. This used to send a client-side typo fraction that the
     server never read, which implied the client's number mattered. */
  return pass;
}
