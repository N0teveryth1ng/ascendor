import { useEffect } from 'react';
import { ArrowRight, CheckCircle2, Flame, PlayCircle, Timer } from 'lucide-react';
import { useForge } from '@/store/useForge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { rankLabel, RANK_BLURB } from '@/lib/copy';
import { moduleLabel } from '@/lib/copy';

const STATE_COPY = {
  NOT_STARTED: { title: "Today's session", body: 'Nothing done yet today. Pick up where you left off.', cta: 'Start session' },
  IN_PROGRESS: { title: "Today's session", body: 'You are partway through today. Pick it back up.', cta: 'Continue session' },
  COMPLETE: { title: "Today's session", body: "Today's work is done. Well done.", cta: 'Practise anything' },
} as const;

export function Home() {
  const { dashboard, user, go, refreshDashboard } = useForge();

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  if (!dashboard) {
    return <div className="mx-auto max-w-5xl space-y-4 p-6">{[0, 1].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-card" />)}</div>;
  }

  const { today, rank, heatmap } = dashboard;
  const copy = STATE_COPY[today.state];
  const nextWhat = rank.next_unlocks[0]?.what;
  const minutes = Math.round(today.block_total_s / 60);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {user?.display_name}</h1>
        <p className="text-sm text-muted-foreground">Here is where you stand today.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">{copy.title}</CardTitle>
                <CardDescription className="text-xs">{copy.body}</CardDescription>
              </div>
              <Badge variant={today.state === 'COMPLETE' ? 'success' : today.state === 'IN_PROGRESS' ? 'warning' : 'muted'}>
                {today.state === 'COMPLETE' ? 'Complete' : today.state === 'IN_PROGRESS' ? 'In progress' : 'Not started'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <PlayCircle className="h-4 w-4" />
                {today.sessions_completed} of {today.target_sessions} sessions
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Timer className="h-4 w-4" />~{minutes} min
              </span>
              {today.active_locks > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Flame className="h-4 w-4 text-warning" />
                  {today.active_locks} topic{today.active_locks === 1 ? '' : 's'} getting extra practice
                </span>
              )}
            </div>

            <Progress
              value={Math.min(100, (today.sessions_completed / Math.max(today.target_sessions, 1)) * 100)}
              indicatorClassName={today.state === 'COMPLETE' ? 'bg-success' : 'bg-primary'}
            />

            {today.forced_repeat_modules.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Today includes extra practice on:{' '}
                {today.forced_repeat_modules.map(moduleLabel).join(', ')}
              </p>
            )}

            <Button size="lg" onClick={() => go('practice')}>
              {copy.cta}
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your level</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-1.5">
                <p className="text-lg font-semibold">{rankLabel(rank.current)}</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="What this level means"
                      className="grid h-4 w-4 place-items-center rounded-full border border-border text-[10px] text-muted-foreground"
                    >
                      ?
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56">{RANK_BLURB[rank.current]}</TooltipContent>
                </Tooltip>
              </div>

              {rank.next ? (
                <>
                  <Progress value={rank.progress_pct} />
                  <p className="text-xs text-muted-foreground">
                    {rank.progress_pct.toFixed(0)}% toward {rankLabel(rank.next)}
                    {nextWhat ? ` — unlocks ${nextWhat}` : ''}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">You are at the top level.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Streak</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <span className="tabular text-3xl">{heatmap.current}</span>
                <span className="text-sm text-muted-foreground">
                  day{heatmap.current === 1 ? '' : 's'} in a row
                  <br />
                  <span className="text-xs">Best: {heatmap.longest} days</span>
                </span>
              </div>
              {today.state === 'COMPLETE' && (
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Today is logged.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
