import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useForge } from '@/store/useForge';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { DailyRoutine } from '@/types';

export function Practice() {
  const { user, go, startStep } = useForge();
  const [routine, setRoutine] = useState<DailyRoutine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.calibrated) return;
    let cancelled = false;
    void api
      .routine()
      .then(({ routine: r }) => {
        if (!cancelled) setRoutine(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user?.calibrated) {
    go('onboarding');
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today&rsquo;s routine</h1>
        <p className="text-sm text-muted-foreground">
          Five blocks, same order every day. What changes is which exercises fill them, based on how
          you are doing.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ol className="space-y-2">
        {(routine?.steps ?? []).map((s) => (
          <li key={s.order} className="flex items-baseline justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <span className="text-sm">
              <span className="tabular mr-2 text-muted-foreground">{s.order}</span>
              {s.block_title}
            </span>
            <span className="text-xs text-muted-foreground">~{s.lock_driven ? 'extra time' : 'standard'}</span>
          </li>
        ))}
      </ol>

      {!routine && !error && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      )}

      <Button size="lg" className="w-full" disabled={!routine || routine.steps.length === 0} onClick={() => startStep(1)}>
        Start Today&rsquo;s Routine
        <ArrowRight />
      </Button>
    </div>
  );
}
