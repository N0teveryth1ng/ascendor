import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TrendSeries } from '@/types';
import { cn } from '@/lib/utils';

const RANGES = [30, 90] as const;

export function MetricTrendChart({ trends }: { trends: TrendSeries[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const series = trends.map((t) => ({ ...t, points: t.points.slice(-range) }));

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">Progress over time</p>
          <Tabs value={String(range)} onValueChange={(v) => setRange(Number(v) as 30 | 90)}>
            <TabsList>
              <TabsTrigger value="30">30 days</TabsTrigger>
              <TabsTrigger value="90">90 days</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <TrendTile key={s.key} series={s} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendTile({ series }: { series: TrendSeries }) {
  const data = useMemo(() => series.points.map((p) => ({ date: shortDate(p.date), value: p.value })), [series.points]);
  const improving = useMemo(() => {
    if (series.change_pct === null) return null;
    if (series.change_pct === 0) return null;
    const positive = series.change_pct > 0;
    return series.direction === 'LOWER_BETTER' ? !positive : positive;
  }, [series]);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{series.label}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">{series.blurb}</p>
        </div>
        {series.change_pct !== null && (
          <span
            className={cn(
              'tabular inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px]',
              improving === null
                ? 'bg-secondary text-muted-foreground'
                : improving
                  ? 'bg-success/15 text-success'
                  : 'bg-warning/15 text-warning',
            )}
          >
            {series.change_pct !== 0 &&
              (series.change_pct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
            {series.change_pct > 0 ? '+' : ''}
            {series.change_pct.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="h-24 w-full">
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={38}
                domain={['auto', 'auto']}
              />
              <RTooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'hsl(var(--popover-foreground))',
                }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                formatter={(v) => [`${Number(v).toFixed(2)}${series.unit}`, series.label]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
            Not enough data yet
          </div>
        )}
      </div>

      <p className="tabular text-xs text-muted-foreground">
        Now: {series.current.toFixed(2)}
        {series.unit}
      </p>
    </div>
  );
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
