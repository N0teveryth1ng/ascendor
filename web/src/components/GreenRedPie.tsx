import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import type { MovementCounts } from '@/types';

const GREEN = 'hsl(var(--success))';
const RED = 'hsl(var(--destructive))';
const FLAT = 'hsl(var(--muted))';

/**
 * Section 13.5. The green/red split the user asked for, as a pie: what share of
 * the candidate's movements were progress versus regression. Only real movements
 * are charted, so a flat step never inflates the denominator.
 */
export function GreenRedPie({ counts, title = 'Upward vs downward movement' }: { counts: MovementCounts; title?: string }) {
  const moved = counts.green + counts.red;
  const data = [
    { name: 'Improved', value: counts.green, color: GREEN },
    { name: 'Slipped', value: counts.red, color: RED },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {moved === 0
              ? 'Not enough movement to compare yet.'
              : `${counts.green} of ${moved} changes were an improvement (${counts.green_pct.toFixed(0)}%).`}
          </p>
        </div>

        {moved === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
            Play a few more sessions to see this.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 sm:flex-row">
            <div className="h-40 w-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={44}
                    outerRadius={66}
                    paddingAngle={2}
                    isAnimationActive={false}
                    stroke="hsl(var(--background))"
                  >
                    {data.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    formatter={(v, n) => [`${v} change(s)`, n]}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="w-full space-y-1.5 text-xs sm:flex-1">
              <SplitRow label="Improved" pct={counts.green_pct} n={counts.green} color={GREEN} />
              <SplitRow label="Slipped" pct={counts.red_pct} n={counts.red} color={RED} />
              {counts.flat > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {counts.flat} unchanged reading{counts.flat === 1 ? '' : 's'} not counted either way.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SplitRow({ label, pct, n, color }: { label: string; pct: number; n: number; color: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="tabular text-muted-foreground">
          {pct.toFixed(0)}% ({n})
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1)}%`, background: color }} />
      </div>
    </div>
  );
}

export { GREEN, RED, FLAT };
