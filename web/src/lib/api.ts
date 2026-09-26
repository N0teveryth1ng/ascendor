import type {
  Attempt,
  CalibrationStatus,
  CandidateProfile,
  Dashboard,
  DrillItem,
  ErrorEvent,
  HistoryResponse,
  ModuleId,
  Onboarding,
  PracticeModule,
  SessionPlan,
  SessionResult,
  StatsBundle,
  Streak,
  StructuralLock,
  TeacherCandidate,
  TeacherDetail,
  User,
} from '../types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  /* auth */
  me: () => request<{ user: User | null; signup_allowed: boolean }>('/auth/me'),
  signIn: (email: string, password: string) => post<{ user: User }>('/auth/signin', { email, password }),
  signUp: (email: string, password: string, display_name: string) =>
    post<{ user: User }>('/auth/signup', { email, password, display_name }),
  signOut: () => post<{ ok: boolean }>('/auth/signout', {}),
  updateProfile: (patch: { display_name?: string; avatar?: string | null; timezone?: string }) =>
    request<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(patch) }),

  /* meta */
  meta: () => request<{ modules: Record<string, unknown>; vectors: string[] }>('/meta'),

  /* candidate data */
  dashboard: () => request<Dashboard>('/dashboard'),
  onboarding: () => request<Onboarding>('/onboarding'),
  practice: () => request<{ modules: PracticeModule[] }>('/practice'),

  /* history + stats - always the signed-in candidate, never an id in the URL */
  history: (params: { limit?: number; offset?: number; module?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set('limit', String(params.limit));
    if (params.offset !== undefined) q.set('offset', String(params.offset));
    if (params.module) q.set('module', params.module);
    const suffix = q.toString();
    return request<HistoryResponse>(`/history${suffix ? `?${suffix}` : ''}`);
  },
  stats: () => request<StatsBundle>('/stats'),

  /* calibration — subject is the session cookie, never a URL segment */
  calibrationStatus: () => request<CalibrationStatus>('/calibration'),
  calibrationBattery: () => request<{ vectors: Record<string, unknown> }>('/calibration/battery'),
  calibrationProbe: (module: string) => request<{ plan: SessionPlan }>(`/calibration/probe?module=${module}`),
  recordPass: (pass: unknown) => post<unknown>('/calibration/passes', pass),
  finalise: (passes: unknown[], recalibrate = false) =>
    post<{ pcp: unknown; profile: CandidateProfile }>('/calibration/finalise', { passes, recalibrate }),

  /* drills */
  profile: () =>
    request<{
      profile: CandidateProfile;
      modules: { id: ModuleId; unlocked: boolean; reason?: string }[];
      sessions: unknown[];
      schedule: unknown;
    }>('/profile'),
  nextSession: (module: string) => request<{ plan: SessionPlan }>(`/session/next?module=${module}`),
  submitSession: (payload: {
    session_id: string;
    module_id: string;
    attempts: Attempt[];
    started_at: string;
    ended_at: string;
    block_id?: string;
    item_payloads?: unknown[];
    delayed_recall_of?: string | null;
  }) => request<{ result: SessionResult; profile: CandidateProfile }>('/session', { method: 'POST', body: JSON.stringify(payload) }),

  /* teacher */
  teacherCandidates: () => request<{ candidates: TeacherCandidate[] }>('/teacher/candidates'),
  teacherDetail: (id: string) => request<TeacherDetail>(`/teacher/candidates/${id}`),
};

export type { DrillItem, ErrorEvent, Streak, StructuralLock };
