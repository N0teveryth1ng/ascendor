import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { RANK_LABEL, rankLabel, moduleLabel } from '@/lib/copy';
import type { RankImpact, StatsBundle } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Section 13.5. Horizontal bars for the green/red split per metric, so the
 * candidate can see which capability is improving and which is slipping
 * side by side rather than only as one overall number.
 */
export function MetricSplitBars({ metrics }: { metrics: StatsBundle['metrics'] }) {
  const data = metrics
    .filter((m) => m.green + m.red > 0)
    .map((m) => ({ label: m.label, green: m.green, red: m.red, green_pct: m.green_pct }));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">Where you are improving</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Green is progress, red is a step back. Longer bars mean more movement to judge.
          </p>
        </div>

        {data.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
            No changes recorded yet.
          </div>
        ) : (
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="label" width={82} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <RTooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'hsl(var(--popover-foreground))',
                  }}
                />
                <Bar dataKey="green" name="Improved" stackId="m" fill="hsl(var(--success))" isAnimationActive={false} radius={[0, 0, 0, 0]}>
                  {data.map((d) => (
                    <Cell key={d.label} />
                  ))}
                </Bar>
                <Bar dataKey="red" name="Slipped" stackId="m" fill="hsl(var(--destructive))" isAnimationActive={false} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Strengths and weaknesses, normalised to the candidate's own range. */
export function StrengthWeaknessCards({ stats }: { stats: StatsBundle }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <RankedList title="Strongest areas" tone="success" items={stats.strengths} />
      <RankedList title="Needs work" tone="warning" items={stats.weaknesses} />
    </div>
  );
}

function RankedList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'success' | 'warning';
  items: StatsBundle['strengths'];
}) {
  return (
    <Card>
      <CardContent className="space-y-2.5 p-4">
        <p className="text-sm font-medium">{title}</p>
        {items.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Not enough data yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((s) => (
              <li key={s.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{s.label}</span>
                  <span className="tabular shrink-0 text-muted-foreground">{s.score.toFixed(0)}/100</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn('h-full rounded-full', tone === 'success' ? 'bg-success' : 'bg-warning')}
                    style={{ width: `${Math.max(Math.min(s.score, 100), 2)}%` }}
                  />
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">{s.blurb}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Every rank change, in plain language, with the sessions it took. */
export function RankImpactTimeline({ stats }: { stats: StatsBundle }) {
  const changes = [...stats.rank_history].reverse();

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Rank changes</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {stats.promotions} up, {stats.demotions} down so far.
            </p>
          </div>
          {stats.rank_current && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              Now: {rankLabel(stats.rank_current)}
            </span>
          )}
        </div>

        {changes.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No rank changes recorded yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {changes.map((c, i) => {
              const prev = changes[i + 1];
              const up = prev ? rankUp(prev.rank, c.rank) : null;
              return (
                <li key={`${c.rank}-${c.at}-${i}`} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 shrink-0">
                    {up === null ? (
                      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : up ? (
                      <TrendingUp className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{RANK_LABEL[c.rank] ?? c.rank}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(c.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {up !== null && (up ? ' - promoted' : ' - moved down a level')}
                      {c.sessions_since_previous !== null &&
                        ` after ${c.sessions_since_previous} session${c.sessions_since_previous === 1 ? '' : 's'}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A higher index in RANK_ORDER is a stronger rank. The order is weakest-first, so
 * a larger index means a promotion. Comparing plain labels would be meaningless.
 */
function rankUp(before: string, after: string): boolean | null {
  const order: string[] = [
    'RANK 03: DECODER',
    'RANK 02: OPERATOR',
    'RANK 01: STRIKER',
    'RANK 00: MASTER',
  ];
  const a = order.indexOf(before);
  const b = order.indexOf(after);
  if (a < 0 || b < 0) return null;
  return b > a;
}

/** Per-quest accuracy bars. */
export function ModuleAccuracyBars({ modules }: { modules: StatsBundle['modules'] }) {
  const data = modules
    .filter((m) => m.attempts > 0)
    .map((m) => ({ ...m, label: moduleLabel(m.module_id) }));
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">Accuracy by drill</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Bar length is how often you were right in each type of drill.
          </p>
        </div>
        {data.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No completed drills yet.</p>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={40} unit="%" domain={[0, 100]} />
                <RTooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'hsl(var(--popover-foreground))',
                  }}
                  formatter={(v, _n, p) => {
                    const row = p?.payload as { sessions?: number; attempts?: number } | undefined;
                    return [`${Number(v).toFixed(1)}% over ${row?.attempts ?? 0} answer(s)`, 'Accuracy'];
                  }}
                />
                <Bar dataKey="accuracy_pct" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { RankImpact };
