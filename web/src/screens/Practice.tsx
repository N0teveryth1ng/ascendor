import { useEffect, useState } from 'react';
import { ArrowRight, Lock } from 'lucide-react';
import { useForge } from '@/store/useForge';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { PracticeModule } from '@/types';
import { moduleLabel } from '@/lib/copy';

const PHASE_COPY: Record<number, string> = {
  1: 'Getting started',
  2: 'Building speed',
  3: 'Sharp instincts',
  4: 'Top pressure',
};

export function Practice() {
  const { user, startModule, setFault } = useForge();
  const [modules, setModules] = useState<PracticeModule[]>([]);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ modules: list }, { modules: gates }] = await Promise.all([api.practice(), api.profile()]);
        if (cancelled) return;
        setModules(list);
        setUnlocked(new Set(gates.filter((g) => g.unlocked).map((g) => g.id as string)));
      } catch (err) {
        if (!cancelled) setFault(err instanceof ApiError ? err.message : 'Could not load your exercises.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, setFault]);

  const byPhase = new Map<number, PracticeModule[]>();
  for (const m of modules) {
    if (!byPhase.has(m.phase)) byPhase.set(m.phase, []);
    byPhase.get(m.phase)!.push(m);
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl space-y-3 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-card" />)}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Practise</h1>
        <p className="text-sm text-muted-foreground">Choose what you want to work on. Each one takes a few minutes.</p>
      </div>

      {[...byPhase.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([phase, list]) => (
          <section key={phase} className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{PHASE_COPY[phase] ?? `Phase ${phase}`}</p>
            {list.map((m) => {
              const isOpen = unlocked.has(m.id);
              return (
                <Card key={m.id} className={isOpen ? '' : 'opacity-60'}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{moduleLabel(m.id)}</CardTitle>
                        {!isOpen && (
                          <Badge variant="muted" className="gap-1">
                            <Lock className="h-3 w-3" /> Locked
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="mt-0.5 text-xs">
                        {isOpen
                          ? m.sessions > 0
                            ? `${m.sessions} session${m.sessions === 1 ? '' : 's'} · ${m.accuracy_pct?.toFixed(2)}% average`
                            : 'Not tried yet'
                          : 'Keep practising to unlock this one'}
                      </CardDescription>
                      {isOpen && m.accuracy_pct !== null && (
                        <Progress value={m.accuracy_pct} className="mt-2 h-1.5 max-w-48" />
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={!isOpen}
                      onClick={() => startModule(m.id)}
                    >
                      {isOpen ? 'Start' : 'Locked'}
                      {isOpen && <ArrowRight />}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        ))}
    </div>
  );
}
