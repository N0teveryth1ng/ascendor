import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, Mic, MicOff, Volume2 } from 'lucide-react';
import { useForge } from '../store/useForge';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { gradeAnswer, toAttempt } from '../lib/grading';
import { openMic, rateForWpm, recordFor, speak, type MicCapture } from '../lib/audio';
import type { Attempt, CalibrationPass, DrillItem, Onboarding } from '@/types';

/**
 * Section 13.7 onboarding. The battery, item source, and pass schema are the
 * engine's; only the presentation, ordering, and wording are ours.
 *
 * Items come from `/calibration/probe`, the one session-plan path that is
 * deliberately NOT PCP-gated: the battery produces the PCP, so gating it here
 * would make calibration unreachable. Each vector draws from the module whose
 * generated content actually measures it.
 */
const PROBE_MODULE: Record<Vector, string> = {
  C1: 'P3_SSM', // LEXICAL RANGE  -> band-gated slot items
  C2: 'P1_VD', // SYNTAX CEILING -> pattern construction
  C3: 'P3_HVS', // AURAL SPEED    -> timed streams
  C4: 'P1_VM', // ARTICULATION   -> bursts + read-aloud
  C5: 'P2_RDI', // ORTHOGRAPHIC    -> dictation
};
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
  const [micLive, setMicLive] = useState(false);

  const item = items[index] ?? null;
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
      const { plan } = await api.calibrationProbe(PROBE_MODULE[vector]);
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
    if (item.kind === 'stream' || item.kind === 'aural') void speak(item.text, { rate: rateForWpm(item.wpm) });
    setInput('');
  }, [item, running]);

  const submit = useCallback(
    async (text: string | null) => {
      if (!item) return;
      const latency = performance.now() - presentedAt.current;
      if (item.kind === 'vocal' && mic) {
        await recordFor(mic.stream, Math.min(4000, Math.max(700, latency)));
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
    const pass = buildPass(vector, passType, attempts, items, mic);
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
        await api.finalise(nextLog);
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
            <Button size="lg" className="w-full" onClick={() => setPhase('pass')}>
              Get started
              <ArrowRight />
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => go('home')}>
              Skip for now
            </Button>
          </CardContent>
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

  if (running && item) {
    const options = 'options' in item && Array.isArray(item.options) ? (item.options as string[]) : null;
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
              <p className="text-sm text-muted-foreground">{timed ? 'Type what you hear.' : step?.prompt}</p>
              <div className="rounded-lg bg-secondary/50 p-4 text-lg leading-relaxed">
                {item.kind === 'pattern' && `${item.pair[0]} / ${item.pair[1]}`}
                {item.kind === 'slot' && (
                  <>
                    <span className="block text-base text-muted-foreground">{item.frame_a}</span>
                    <span className="mt-1 block font-medium">{item.swapped_condition}</span>
                  </>
                )}
                {item.kind === 'syntax' && item.scaffold}
                {(item.kind === 'microtext' || item.kind === 'stream' || item.kind === 'aural') && item.text}
                {(item.kind === 'vocal' || item.kind === 'burst') && item.text}
                {item.kind === 'anomaly' && item.tokens.join(' · ')}
                {item.kind === 'swap' && `${item.pair[0]} / ${item.pair[1]}`}
                {(item.kind === 'stream' || item.kind === 'aural') && (
                  <Button variant="ghost" size="sm" className="ml-2 gap-1.5 text-xs" onClick={() => void speak(item.text, { rate: rateForWpm(item.wpm) })}>
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
    const byBand: Record<string, number> = {};
    for (const a of attempts) {
      const band = a.item_id.split('-')[2] ?? 'V1';
      byBand[band] = (byBand[band] ?? 0) + (a.correct ? 1 : 0);
    }
    pass.band_accuracy = byBand;
  }
  if (vector === 'C3') {
    const withWpm = items.find((i) => 'wpm' in i);
    pass.wpm = withWpm && 'wpm' in withWpm ? withWpm.wpm : 0;
  }
  if (vector === 'C4') {
    pass.clarity = Math.round((mic?.peak() ?? 0) * 100);
    pass.phoneme_classes = {};
  }
  if (vector === 'C5') {
    const typos = attempts.filter((a) => a.error_code === 'TYPO_DETECTED').length;
    pass.typo_vulnerability_index = total ? Number((typos / total).toFixed(4)) : 0;
  }
  return pass;
}
