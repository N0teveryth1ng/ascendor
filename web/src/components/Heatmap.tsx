import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Heatmap as HeatmapData } from '@/types';
import { cn } from '@/lib/utils';

const LEVELS = ['bg-secondary', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'];
const WEEKDAYS = ['Mon', 'Wed', 'Fri'];

function fmt(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function StreakHeatmap({ data }: { data: HeatmapData }) {
  const [hover, setHover] = useState<string | null>(null);

  const weeks = useMemo(() => {
    const out: (typeof data.days)[] = [];
    for (let i = 0; i < data.days.length; i += 7) out.push(data.days.slice(i, i + 7));
    return out;
  }, [data.days]);

  const monthLabels = useMemo(
    () =>
      weeks.map((week, i) => {
        const first = week[0];
        if (!first) return null;
        const month = new Date(`${first.date}T00:00:00Z`).toLocaleDateString(undefined, {
          month: 'short',
          timeZone: 'UTC',
        });
        const prev = weeks[i - 1]?.[0];
        const prevMonth = prev
          ? new Date(`${prev.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
          : null;
        return month !== prevMonth ? month : null;
      }),
    [weeks],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="text-base">Practice streak</CardTitle>
            <CardDescription className="text-xs">Each square is one day.</CardDescription>
          </div>
          <div className="flex gap-5">
            <Stat value={data.current} label="Current" />
            <Stat value={data.longest} label="Longest" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="scrollbar-thin overflow-x-auto pb-1">
          <div className="inline-flex gap-1">
            <div className="mr-1 flex flex-col justify-between py-0.5">
              {WEEKDAYS.map((d) => (
                <span key={d} className="h-3 text-[10px] leading-3 text-muted-foreground">
                  {d}
                </span>
              ))}
            </div>
            <div>
              <div className="mb-1 flex h-4 gap-1">
                {monthLabels.map((label, i) => (
                  <span key={i} className="w-3 text-[10px] leading-4 text-muted-foreground">
                    {label ?? ''}
                  </span>
                ))}
              </div>
              <div className="flex gap-1" onMouseLeave={() => setHover(null)}>
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-1">
                    {week.map((day) => (
                      <Tooltip key={day.date}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`${fmt(day.date)}: ${day.sessions} session${day.sessions === 1 ? '' : 's'}`}
                            onMouseEnter={() => setHover(day.date)}
                            className={cn(
                              'h-3 w-3 rounded-[3px] transition-all',
                              LEVELS[day.level],
                              hover === day.date && 'ring-2 ring-ring ring-offset-1 ring-offset-card',
                            )}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">{fmt(day.date)}</p>
                          <p className="text-muted-foreground">
                            {day.sessions === 0 ? 'No practice' : `${day.sessions} session${day.sessions === 1 ? '' : 's'} · ${day.pct.toFixed(0)}%`}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Less</span>
          {LEVELS.map((l, i) => (
            <span key={i} className={cn('h-2.5 w-2.5 rounded-[3px]', l)} />
          ))}
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="tabular text-xl leading-none">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
