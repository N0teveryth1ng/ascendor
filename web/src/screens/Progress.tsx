import { useEffect, useState } from 'react';
import { useForge } from '@/store/useForge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StreakHeatmap } from '@/components/Heatmap';
import { MetricTrendChart } from '@/components/MetricTrendChart';
import { ModuleBreakdownChart } from '@/components/ModuleBreakdownChart';
import { rankLabel } from '@/lib/copy';
import { api } from '@/lib/api';
import { GreenRedPie } from '@/components/GreenRedPie';
import { MetricSplitBars, ModuleAccuracyBars, RankImpactTimeline, StrengthWeaknessCards } from '@/components/StatsCharts';
import type { StatsBundle } from '@/types';

export function Progress() {
  const { dashboard, refreshDashboard } = useForge();
  const [stats, setStats] = useState<StatsBundle | null>(null);

  useEffect(() => {
    void refreshDashboard();
    void api
      .stats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [refreshDashboard]);

  if (!dashboard) {
    return <div className="mx-auto max-w-5xl space-y-4 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-card" />)}</div>;
  }

  const strongest = [...dashboard.modules].filter((m) => m.attempts > 0).sort((a, b) => b.accuracy_pct - a.accuracy_pct)[0];
  const weakest = [...dashboard.modules].filter((m) => m.attempts > 0).sort((a, b) => a.accuracy_pct - b.accuracy_pct)[0];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your progress</h1>
        <p className="text-sm text-muted-foreground">Everything the app is tracking, in plain terms.</p>
      </div>

      <StreakHeatmap data={dashboard.heatmap} />
      <MetricTrendChart trends={dashboard.trends} />
      <ModuleBreakdownChart modules={dashboard.modules} />

      {stats && (
        <>
          <GreenRedPie counts={stats.overall} />
          <StrengthWeaknessCards stats={stats} />
          <MetricSplitBars metrics={stats.metrics} />
          <ModuleAccuracyBars modules={stats.modules} />
          <RankImpactTimeline stats={stats} />
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Strongest area</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{strongest?.label ?? '—'}</p>
            {strongest && <p className="tabular text-sm text-muted-foreground">{strongest.accuracy_pct.toFixed(2)}% accuracy</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Room to grow</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{weakest && weakest !== strongest ? weakest.label : '—'}</p>
            {weakest && <p className="tabular text-sm text-muted-foreground">{weakest.accuracy_pct.toFixed(2)}% accuracy</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Current level</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{rankLabel(dashboard.rank.current)}</p>
            <CardDescription className="mt-1 text-xs">
              {dashboard.rank.next ? `${dashboard.rank.progress_pct.toFixed(0)}% toward the next level` : 'Top level reached'}
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
