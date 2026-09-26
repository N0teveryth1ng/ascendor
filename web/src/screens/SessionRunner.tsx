import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic, MicOff, Volume2, XCircle } from 'lucide-react';
import { useForge } from '../store/useForge';
import { api } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { gradeAnswer, toAttempt } from '../lib/grading';
import { openMic, recordFor, speak, type MicCapture } from '../lib/audio';
import { itemView } from '../lib/itemView';
import { feedback, focusLine, moduleLabel, rankLabel } from '../lib/copy';
import type { Attempt, DrillItem, SessionPlan, SessionResult } from '../types';

interface ItemFeedback {
  input: string | null;
  expected: string | null;
  text: string;
  tone: 'success' | 'error' | 'warning';
  correct: boolean;
}

export function SessionRunner() {
  const { user, pendingModule, go, setResult, setFault, refreshDashboard } = useForge();
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [last, setLast] = useState<ItemFeedback | null>(null);
  const [input, setInput] = useState('');
  const [mic, setMic] = useState<MicCapture | null>(null);
  const [micLive, setMicLive] = useState(false);
  const [speechOk, setSpeechOk] = useState(true);
  const [locked, setLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setLocalResult] = useState<SessionResult | null>(null);

  const item = plan?.items[index] ?? null;
  const presentedAt = useRef(0);
  const planLoadedAt = useRef(0);
  const deadlineRef = useRef<number | null>(null);

  const needsVoice = !!item && itemView(item).voice;
  const finished = !!plan && index >= plan.items.length;

  useEffect(() => {
    if (!user || !pendingModule) return;
    let cancelled = false;
    setPlan(null);
    setAttempts([]);
    setLast(null);
    setIndex(0);
    setResult(null);
    setLocalResult(null);
    api
      .nextSession(pendingModule)
      .then(({ plan: p }) => {
        if (cancelled) return;
        setPlan(p);
        planLoadedAt.current = performance.now();
      })
      .catch((e: Error) => setFault(e.message));
    return () => {
      cancelled = true;
    };
  }, [user, pendingModule, setFault, setResult]);

  const present = useCallback(
    async (next: DrillItem, activePlan: SessionPlan) => {
      presentedAt.current = performance.now();
      if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
      deadlineRef.current = null;

        const view = itemView(next);
        if (view.speech) {
          void speak(view.speech.text, { rate: view.speech.wpm ?? activePlan.speed_multiplier });
        }

        // Items the candidate reads or recalls are held to a window, and a
        // missed window commits a null answer so the attempt is scored as a miss
        // rather than silently dropped.
        if (view.inputless || view.timed) {
          deadlineRef.current = window.setTimeout(() => {
            void commit(null, true);
          }, view.durationMs);
        }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, index],
  );

  useEffect(() => {
    if (!item || !plan) return;
    setInput('');
    setLast(null);
    setLocked(false);
    void present(item, plan);
    return () => {
      if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, plan]);

  useEffect(() => {
    if (!needsVoice) return;
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
  }, [needsVoice]);

  const commit = useCallback(
    async (text: string | null, timedOut = false) => {
      if (!plan || !item || locked) return;
      setLocked(true);
      const latency = timedOut ? item.threshold_ms * 10 : performance.now() - presentedAt.current;

        if (itemView(item).voice && mic) {
        await recordFor(mic.stream, Math.min(4000, Math.max(700, latency)));
      }

      const grade = timedOut
        ? {
            ...gradeAnswer(item, null, item.threshold_ms * 10),
            correct: false,
            correct_chars: 0,
          }
        : gradeAnswer(item, text, latency);

      const attempt = toAttempt(item, grade, text, latency);
      const fb = feedback(grade.code, grade.category, text, attempt.expected);
      setAttempts((a) => [...a, attempt]);
      setLast({
        input: text,
        expected: attempt.expected,
        text: timedOut ? 'Time ran out on this one.' : fb.text,
        tone: timedOut ? 'error' : fb.tone,
        correct: grade.correct,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, item, locked, mic],
  );

  const advance = useCallback(() => {
    if (!plan) return;
    setLast(null);
    setLocked(false);
    if (index + 1 >= plan.items.length) {
      setIndex(plan.items.length);
      setLocked(true);
    } else {
      setIndex((i) => i + 1);
    }
  }, [index, plan]);

  const finish = useCallback(async () => {
    if (!user || !plan || !attempts.length) return;
    setSubmitting(true);
    try {
      const res = await api.submitSession({
        session_id: plan.session_id,
        module_id: plan.module_id,
        attempts,
        started_at: new Date(Date.now() - (performance.now() - planLoadedAt.current)).toISOString(),
        ended_at: new Date().toISOString(),
        delayed_recall_of: plan.delayed_recall?.session_id ?? null,
        item_payloads: plan.items.map(promptPayload),
      });
      setResult(res.result);
      setLocalResult(res.result);
      await refreshDashboard();
    } catch (e) {
      setFault((e as Error).message);
      setSubmitting(false);
    }
  }, [user, plan, attempts, setFault, setResult, refreshDashboard]);

  const answered = useMemo(() => attempts.length, [attempts]);

  if (!user) return null;
  if (result) return <SessionSummary result={result} onDone={() => go('home')} onAgain={() => go('practice')} />;

  if (!plan) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Building your session…
      </div>
    );
  }

  if (finished) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardHeader>
            <CardTitle>Session complete</CardTitle>
            <CardDescription>{answered} questions answered in {moduleLabel(plan.module_id)}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" size="lg" disabled={submitting || !answered} onClick={() => void finish()}>
              {submitting && <Loader2 className="animate-spin" />}
              Save session
            </Button>
            <Button className="w-full" variant="ghost" onClick={() => go('practice')}>
              Back to exercises
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <p className="font-medium">{moduleLabel(plan.module_id)}</p>
          <p className="tabular text-muted-foreground">
            {index + 1} of {plan.items.length}
          </p>
        </div>
        <Progress value={((index + (last ? 1 : 0)) / Math.max(plan.items.length, 1)) * 100} />
        {plan.delayed_recall && (
          <p className="text-xs text-muted-foreground">This one revisits something from your last session.</p>
        )}
      </div>

      {needsVoice && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {micLive ? <Mic className="h-3.5 w-3.5 text-success" /> : <MicOff className="h-3.5 w-3.5 text-warning" />}
          {micLive ? 'Microphone ready — you can also type your answer' : 'Microphone unavailable — type your answer instead'}
        </p>
      )}

      <Card>
        <CardContent className="space-y-5 p-6">
          <Question
            item={item!}
            input={input}
            setInput={setInput}
            disabled={locked}
            micLive={micLive}
            speechOk={speechOk}
            onSpeech={async () => {
              if (!speechOk) {
                setSpeechOk(false);
                return;
              }
                await speak(itemView(item!).speech?.text ?? itemView(item!).body);
            }}
            onSubmit={() => void commit(input.trim() || null)}
          />

          {last && (
            <div
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                last.tone === 'success'
                  ? 'border-success/30 bg-success/10 text-success'
                  : last.tone === 'warning'
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
              }`}
              role="status"
            >
              {last.correct ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{last.text}</p>
                {!last.correct && last.expected && (
                  <p className="text-xs opacity-90">
                    You wrote: <span className="font-medium">{last.input?.trim() || '—'}</span> · Answer:{' '}
                    <span className="font-medium">{last.expected}</span>
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {last ? (
        <Button size="lg" className="w-full" onClick={advance}>
          {index + 1 >= plan.items.length ? 'See results' : 'Next question'}
        </Button>
      ) : (
        <p className="text-center text-xs text-muted-foreground">Take your time — accuracy matters more than speed here.</p>
      )}
    </div>
  );
}

function Question({
  item,
  input,
  setInput,
  disabled,
  micLive,
  speechOk,
  onSpeech,
  onSubmit,
}: {
  item: DrillItem;
  input: string;
  setInput: (v: string) => void;
  disabled: boolean;
  micLive: boolean;
  speechOk: boolean;
  onSpeech: () => Promise<void>;
  onSubmit: () => void;
}) {
  const options = 'options' in item && Array.isArray(item.options) ? (item.options as string[]) : null;

  return (
    <div className="space-y-5">
      <Prompt item={item} speechOk={speechOk} onSpeech={onSpeech} />

      {options ? (
        <div className="grid gap-2">
          {options.map((o) => (
            <Button
              key={o}
              variant="outline"
              size="lg"
              className="justify-start text-left"
              disabled={disabled}
              onClick={() => {
                setInput(o);
                onSubmit();
              }}
            >
              {o}
            </Button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            disabled={disabled}
            className="text-base"
            placeholder={micLive ? 'Type what you said, or press enter' : 'Type your answer'}
            aria-label="Your answer"
          />
          <Button type="submit" size="lg" disabled={disabled || !input.trim()}>
            Check
          </Button>
        </form>
      )}
    </div>
  );
}

function Prompt({ item, speechOk, onSpeech }: { item: DrillItem; speechOk: boolean; onSpeech: () => Promise<void> }) {
  const view = useMemo(() => itemView(item), [item]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{view.prompt}</p>
      <div className="whitespace-pre-wrap rounded-lg bg-secondary/50 p-4">
        {view.inputless ? (
          <p className="tabular text-sm text-muted-foreground">
            {item.kind === 'scene' ? 'The scene is hidden until time is up.' : view.prompt}
          </p>
        ) : (
          <p className="text-lg leading-relaxed">
            {view.body}
            {view.detail && (
              <span className="mt-2 block text-base text-muted-foreground">{view.detail}</span>
            )}
          </p>
        )}
      </div>
      {view.speech && speechOk && (
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => void onSpeech()}>
          <Volume2 className="h-3.5 w-3.5" /> Play again
        </Button>
      )}
    </div>
  );
}

/**
 * The record of what was actually shown, sent with the submitted attempts so the
 * server can recompute grading without re-deriving the prompt from the item.
 * It previously reported `aural`/`swap`/`anomaly`/`recall` kinds the engine
 * never emits and silently fell through to `{ kind: 'unknown' }`, so every
 * dictation and pressure attempt reached history with no prompt at all.
 */
function promptPayload(item: DrillItem): unknown {
  switch (item.kind) {
    case 'pattern':
      return { kind: 'pattern', item_id: item.item_id, prompt: `Which fits: ${item.pair[0]} / ${item.pair[1]}`, pair: item.pair };
    case 'syntax':
      return { kind: 'syntax', item_id: item.item_id, prompt: item.scaffold, scaffold: item.scaffold, level: item.level };
    case 'slot':
      return { kind: 'slot', item_id: item.item_id, prompt: item.swapped_condition, frame_a: item.frame_a, slot_category: item.slot_category };
    case 'microtext':
      return { kind: 'microtext', item_id: item.item_id, prompt: item.sentences.join(' '), blank_index: item.blank_index, options: item.options };
    case 'burst':
      return { kind: 'burst', item_id: item.item_id, prompt: item.group_label, token: item.token, repetitions: item.repetitions };
    case 'stream':
      return { kind: 'stream', item_id: item.item_id, prompt: item.tokens.join(' '), tokens: item.tokens, wpm: item.wpm, anomaly_token: item.anomaly_token };
    case 'dictation':
      return { kind: 'dictation', item_id: item.item_id, prompt: 'Audio dictation', char_count: item.text.length, trap_category: item.trap_category };
    case 'read_aloud':
      return { kind: 'read_aloud', item_id: item.item_id, prompt: item.title, passage_id: item.passage_id, hesitation_targets: item.hesitation_targets };
    case 'scene':
      return { kind: 'scene', item_id: item.item_id, prompt: item.title, scene_id: item.scene_id, slots: item.slots, slot_count: item.slot_count };
    case 'pressure':
      return { kind: 'pressure', item_id: item.item_id, prompt: item.visual_cue, wpm: item.wpm, response_window_ms: item.response_window_ms, window_reduction_pct: item.window_reduction_pct };
    default: {
      const exhaustive: never = item;
      throw new Error(`unhandled drill item kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function SessionSummary({ result, onDone, onAgain }: { result: SessionResult; onDone: () => void; onAgain: () => void }) {
  const passed = result.accuracy_pct >= 85;
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{passed ? 'Nice work' : 'Session done'}</CardTitle>
          <CardDescription>{focusLine(result)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Accuracy" value={`${result.accuracy_pct.toFixed(0)}%`} good={passed} />
            <Figure label="Average time" value={`${(result.mean_latency_ms / 1000).toFixed(1)}s`} />
            <Figure label="Pace" value={`${result.speed_multiplier.toFixed(2)}×`} />
            <Figure label="Level" value={result.rank_change ? rankLabel(result.rank_change.to) : 'Holding'} />
          </div>

          {result.structural_locks_cleared.length > 0 && (
            <>
              <Separator />
              <p className="text-sm text-success">A topic you have been working on is now back on track.</p>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={onDone}>
              Back to home
            </Button>
            <Button variant="ghost" onClick={onAgain}>
              Practise something else
            </Button>
          </div>
        </CardContent>
      </Card>
      <Badge variant="muted" className="mx-auto flex w-fit">
        {result.module_id} · {result.daily_tier.streak_after} day streak
      </Badge>
    </div>
  );
}

function Figure({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`tabular text-lg ${good === undefined ? '' : good ? 'text-success' : 'text-warning'}`}>{value}</p>
    </div>
  );
}
