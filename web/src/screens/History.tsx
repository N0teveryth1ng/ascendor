import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History as HistoryIcon, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { moduleLabel } from '@/lib/copy';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { HistoryEntry, HistoryResponse } from '@/types';
import { cn } from '@/lib/utils';

const PAGE = 20;

/**
 * Section 13.4 HISTORY. Every attempted quest, newest first, expandable down to
 * the individual answers. Nothing here is editable: the list is a read model
 * over the append-only record.
 */
export function History() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMore, setBusyMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, append: boolean) => {
    append ? setBusyMore(true) : setLoading(true);
    try {
      const page = await api.history({ limit: PAGE, offset: nextOffset });
      setData((prev) =>
        append && prev
          ? { ...page, entries: [...prev.entries, ...page.entries] }
          : page,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your history.');
    } finally {
      append ? setBusyMore(false) : setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0, false);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading your history.
      </div>
    );
  }

  const t = data?.totals;
  const hasMore = data ? data.offset + data.entries.length < data.total : false;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">History</h1>
        <p className="text-sm text-muted-foreground">
          Every session you have attempted, kept permanently.
        </p>
      </header>

      {t && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Sessions" value={String(t.sessions)} />
          <Stat label="Answers" value={String(t.attempts)} />
          <Stat label="Correct" value={`${t.accuracy_pct.toFixed(0)}%`} />
          <Stat label="Time practised" value={formatDuration(t.total_duration_ms)} />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && data.entries.length === 0 && !error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <HistoryIcon className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing here yet</p>
            <p className="text-xs text-muted-foreground">
              Once you attempt a session it will be listed here with every answer.
            </p>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {data?.entries.map((e) => (
          <HistoryRow
            key={e.session_id}
            entry={e}
            open={expanded === e.session_id}
            onToggle={() => setExpanded((cur) => (cur === e.session_id ? null : e.session_id))}
          />
        ))}
      </ul>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" disabled={busyMore} onClick={() => void load(data!.offset + PAGE, true)}>
            {busyMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Show older
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="tabular text-lg font-semibold leading-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function HistoryRow({ entry, open, onToggle }: { entry: HistoryEntry; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <Card>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-3 p-3 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="text-sm font-medium">{entry.module_name || moduleLabel(entry.module_id)}</span>
              {entry.is_delayed_recall && (
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  memory check
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {new Date(entry.started_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {` - ${entry.attempt_count} answer${entry.attempt_count === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn('tabular text-sm font-semibold', entry.accuracy_pct >= 85 ? 'text-success' : 'text-warning')}>
              {entry.accuracy_pct.toFixed(0)}%
            </p>
            <p className="tabular text-[11px] text-muted-foreground">{Math.round(entry.mean_latency_ms)}ms avg</p>
          </div>
        </button>

        {open && (
          <CardContent className="space-y-3 border-t border-border p-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
              <Fact label="Duration" value={formatDuration(entry.duration_ms)} />
              <Fact label="Speed target" value={`${Math.round(entry.threshold_ms)}ms`} />
              <Fact label="Speed setting" value={`${entry.speed_multiplier.toFixed(2)}x`} />
              <Fact
                label="Characters"
                value={`${entry.char_correct}/${entry.char_total}`}
              />
            </dl>

            {entry.errors.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Mistakes recorded: {entry.errors.join(', ').replace(/_/g, ' ')}
              </p>
            )}

            <ol className="space-y-1">
              {entry.attempts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-2 rounded-md border border-border/60 px-2 py-1.5 text-[11px]"
                >
                  <span
                    className={cn(
                      'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      a.correct ? 'bg-success' : 'bg-destructive',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {a.question_shown || a.item_id}
                    </p>
                    {!a.correct && (a.answer_given || a.input) && (
                      <p className="text-muted-foreground">
                        You answered &ldquo;{a.answer_given || a.input}&rdquo;
                        {a.expected ? ` - it was &ldquo;${a.expected}&rdquo;` : ''}
                      </p>
                    )}
                  </div>
                  <span className="tabular shrink-0 text-muted-foreground">{Math.round(a.latency_ms)}ms</span>
                </li>
              ))}
            </ol>
          </CardContent>
        )}
      </Card>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
