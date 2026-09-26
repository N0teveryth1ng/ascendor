import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, Gauge, Lock, RefreshCw } from 'lucide-react';
import { useForge } from '@/store/useForge';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TeacherCandidate, TeacherDetail } from '@/types';

export function Teacher() {
  const { setFault } = useForge();
  const [candidates, setCandidates] = useState<TeacherCandidate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .teacherCandidates()
      .then(({ candidates: list }) => setCandidates(list))
      .catch((e) => setFault(e instanceof ApiError ? e.message : (e as Error).message))
      .finally(() => setLoading(false));
  }, [setFault]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    api
      .teacherDetail(selected)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => !cancelled && setFault(e instanceof ApiError ? e.message : (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [selected, setFault]);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading candidates…</div>;
  }

  if (!selected) return <CandidateTable candidates={candidates} onSelect={setSelected} />;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{detail?.candidate.display_name ?? 'Candidate'}</h1>
          <p className="text-sm text-muted-foreground">
            {detail?.candidate.email} · {detail?.candidate.rank_plain}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!detail} onClick={() => selected && void api.teacherDetail(selected).then(setDetail)}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            All candidates
          </Button>
        </div>
      </div>

      {!detail ? (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">Loading detail…</div>
      ) : (
        <>
          <Card className="border-primary/40 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">This week&rsquo;s recommendation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{detail.recommendation}</p>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Gauge className="h-4 w-4" /> Control point
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                {!detail.pcp ? (
                  <p className="text-muted-foreground">Not calibrated.</p>
                ) : (
                  Object.entries(detail.pcp).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="truncate font-mono text-muted-foreground">{k}</span>
                      <span className="tabular font-medium">{typeof v === 'number' ? v.toFixed(3) : String(v)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Lock className="h-4 w-4" /> Structural locks
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.structural_locks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None recorded.</p>
                ) : (
                  detail.structural_locks.map((l) => (
                    <div
                      key={l.key}
                      className={`rounded-md border p-2 text-xs ${l.active ? 'border-warning/30 bg-warning/10' : 'border-border'}`}
                    >
                      <p className={`font-medium ${l.active ? 'text-warning' : 'text-muted-foreground'}`}>
                        {l.module_plain} · {l.tag}
                      </p>
                      <p className="text-muted-foreground">
                        {l.sessions_flagged}/{l.sessions_remaining + l.sessions_flagged} sessions · diversion{' '}
                        {(l.diversion_pct * 100).toFixed(0)}% · escalation {l.blocks_escalation ? 'blocked' : 'allowed'}
                        {l.active ? '' : ' · cleared'}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4" /> Error tags
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {detail.error_tag_frequency.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None recorded.</p>
                ) : (
                  detail.error_tag_frequency.map((t) => {
                    const max = Math.max(...detail.error_tag_frequency.map((x) => x.count));
                    return (
                      <div key={t.tag} className="flex items-center gap-2 text-xs">
                        <span className="w-36 shrink-0 truncate font-mono" title={t.plain}>
                          {t.tag}
                        </span>
                        <Progress value={(t.count / max) * 100} className="h-1.5" />
                        <span className="tabular text-muted-foreground">{t.count}</span>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="ape">
            <TabsList>
              <TabsTrigger value="ape">APE history</TabsTrigger>
              <TabsTrigger value="rolling">Rolling windows</TabsTrigger>
              <TabsTrigger value="sessions">Recent sessions</TabsTrigger>
              <TabsTrigger value="archive">Attempt archive</TabsTrigger>
            </TabsList>

            <TabsContent value="ape" className="pt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recorded</TableHead>
                        <TableHead>Module</TableHead>
                        <TableHead>Factor</TableHead>
                        <TableHead>Threshold</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.ape_history.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-muted-foreground">
                            No adjustments recorded.
                          </TableCell>
                        </TableRow>
                      ) : (
                        detail.ape_history.map((h, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-muted-foreground">{h.recorded_at}</TableCell>
                            <TableCell>{h.module_id}</TableCell>
                            <TableCell className="tabular">{h.factor.toFixed(3)}</TableCell>
                            <TableCell className="tabular">
                              {h.threshold_before_ms.toFixed(0)} → {h.threshold_after_ms.toFixed(0)}ms
                            </TableCell>
                            <TableCell className="text-muted-foreground">{h.reason}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="rolling" className="pt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Module</TableHead>
                        <TableHead>Threshold</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Sessions</TableHead>
                        <TableHead>Mean accuracy</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(detail.rolling_windows).map(([module, w]) => (
                        <TableRow key={module}>
                          <TableCell>{module}</TableCell>
                          <TableCell className="tabular">{w.threshold_ms.toFixed(0)}ms</TableCell>
                          <TableCell className="tabular">{w.speed_multiplier.toFixed(3)}×</TableCell>
                          <TableCell>{w.sessions}</TableCell>
                          <TableCell className="tabular">{(w.mean_accuracy * 100).toFixed(2)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sessions" className="pt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Module</TableHead>
                        <TableHead>Accuracy</TableHead>
                        <TableHead>Mean latency</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.recent_sessions.map((s) => (
                        <TableRow key={s.session_id}>
                          <TableCell className="text-muted-foreground">{s.started_at}</TableCell>
                          <TableCell>{s.module_plain}</TableCell>
                          <TableCell className="tabular">{s.accuracy_pct.toFixed(2)}%</TableCell>
                          <TableCell className="tabular">{s.mean_latency_ms.toFixed(0)}ms</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="archive" className="pt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recorded</TableHead>
                        <TableHead>Module</TableHead>
                        <TableHead>Prompt shown</TableHead>
                        <TableHead>Answer</TableHead>
                        <TableHead>Latency</TableHead>
                        <TableHead>Tag</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.recent_attempts.map((a) => (
                        <TableRow key={`${a.exercise_id}-${a.created_at}`}>
                          <TableCell className="text-muted-foreground">{a.created_at}</TableCell>
                          <TableCell>{a.module_id}</TableCell>
                          <TableCell className="max-w-72 truncate" title={a.question_shown}>
                            {a.question_shown}
                          </TableCell>
                          <TableCell>
                            <span className={a.is_correct ? 'text-success' : 'text-destructive'}>
                              {a.answer_given ?? '—'}
                            </span>
                          </TableCell>
                          <TableCell className="tabular">{a.response_time_ms.toFixed(0)}ms</TableCell>
                          <TableCell className="font-mono text-xs" title={a.error_plain ?? ''}>
                            {a.error_tag ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <p className="mt-2 text-xs text-muted-foreground">
                Section 13.4 keeps every attempt permanently, including the raw prompt, the raw tag, and which hidden metric it
                fed. Candidates never see this table.
              </p>
            </TabsContent>
          </Tabs>

          {detail.pending_remediation.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4" /> Remediation queue
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {detail.pending_remediation.map((id) => (
                  <Badge key={id} variant="muted">
                    {id}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Candidate dashboard snapshot</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Metric label="Streak" value={`${detail.dashboard.heatmap.current} d`} />
              <Metric label="Sessions" value={String(detail.candidate.sessions_total)} />
              <Metric label="Today" value={`${detail.dashboard.today.sessions_completed}/${detail.dashboard.today.target_sessions}`} />
              <Metric label="Active locks" value={String(detail.dashboard.today.active_locks)} />
              <Metric label="Weekly accuracy" value={detail.candidate.weekly_accuracy === null ? '—' : `${(detail.candidate.weekly_accuracy * 100).toFixed(1)}%`} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function CandidateTable({ candidates, onSelect }: { candidates: TeacherCandidate[]; onSelect: (id: string) => void }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
        <p className="text-sm text-muted-foreground">Observer view. Pick a candidate to see their full diagnostic record.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Streak</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead>Locks</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No candidates yet.
                  </TableCell>
                </TableRow>
              ) : (
                candidates.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => onSelect(c.id)}>
                    <TableCell className="font-medium">
                      {c.display_name}
                      {!c.calibrated && <span className="ml-2 text-xs text-muted-foreground">setup incomplete</span>}
                    </TableCell>
                    <TableCell>{c.rank_plain}</TableCell>
                    <TableCell className="tabular">{c.streak}</TableCell>
                    <TableCell className="tabular">{c.sessions_total}</TableCell>
                    <TableCell>
                      <Badge variant={c.active_locks > 0 ? 'warning' : 'muted'}>{c.active_locks}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.last_active ?? 'Never'}</TableCell>
                    <TableCell>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular text-sm font-medium">{value}</p>
    </div>
  );
}
