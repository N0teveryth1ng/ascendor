import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ModuleBreakdown } from '@/types';

type Mode = 'accuracy' | 'speed';

export function ModuleBreakdownChart({ modules }: { modules: ModuleBreakdown[] }) {
  const [mode, setMode] = useState<Mode>('accuracy');

  const data = useMemo(
    () =>
      modules
        .filter((m) => m.attempts > 0)
        .map((m) => ({
          label: m.label,
          accuracy: m.accuracy_pct,
          response: m.avg_response_ms,
        })),
    [modules],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Where you are strong</CardTitle>
            <CardDescription className="text-xs">Your last 30 days, by exercise type.</CardDescription>
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
              <TabsTrigger value="speed">Response time</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Complete a session and your breakdown will appear here.
          </p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={128}
                  tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <RTooltip
                  cursor={{ fill: 'hsl(var(--accent))', opacity: 0.4 }}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'hsl(var(--popover-foreground))',
                  }}
                  formatter={(v) => [mode === 'accuracy' ? `${Number(v).toFixed(2)}%` : `${Math.round(Number(v))} ms`, 'Value']}
                />
                <Bar dataKey={mode === 'accuracy' ? 'accuracy' : 'response'} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {data.map((d) => {
                    const strong = mode === 'accuracy' ? d.accuracy >= 90 : d.response > 0 && d.response <= 2500;
                    return <Cell key={d.label} fill={strong ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
