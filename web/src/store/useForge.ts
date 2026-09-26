import { create } from 'zustand';
import { api, ApiError } from '@/lib/api';
import type { CandidateProfile, Dashboard, SessionResult, User } from '@/types';

export type View = 'home' | 'practice' | 'progress' | 'history' | 'onboarding' | 'session' | 'teacher';

interface ForgeState {
  user: User | null;
  dashboard: Dashboard | null;
  profile: CandidateProfile | null;
  lastResult: SessionResult | null;
  pendingModule: string;
  view: View;
  booting: boolean;
  signupAllowed: boolean;
  fault: string | null;

  boot: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  go: (view: View) => void;
  startModule: (moduleId: string) => void;
  refreshDashboard: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setResult: (r: SessionResult | null) => void;
  setFault: (m: string) => void;
  clearFault: () => void;
}

function message(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export const useForge = create<ForgeState>((set, get) => ({
  user: null,
  dashboard: null,
  profile: null,
  lastResult: null,
  pendingModule: 'P1_VD',
  view: 'home',
  booting: true,
  signupAllowed: true,
  fault: null,

  boot: async () => {
    try {
      const { user, signup_allowed } = await api.me();
      if (!user) {
        set({ user: null, booting: false, view: 'home', signupAllowed: signup_allowed });
        return;
      }
      set({
        user,
        booting: false,
        signupAllowed: signup_allowed,
        view: user.role === 'admin' ? 'teacher' : user.calibrated ? 'home' : 'onboarding',
      });
      if (user.role === 'candidate') {
        if (user.calibrated) await get().refreshDashboard();
        else await get().refreshProfile();
      }
    } catch (err) {
      set({ booting: false, fault: message(err) });
    }
  },

  signIn: async (email, password) => {
    const { user } = await api.signIn(email, password);
    set({ user, fault: null, view: user.role === 'admin' ? 'teacher' : user.calibrated ? 'home' : 'onboarding' });
    if (user.role === 'candidate') {
      if (user.calibrated) await get().refreshDashboard();
      else await get().refreshProfile();
    }
  },

  signUp: async (email, password, name) => {
    const { user } = await api.signUp(email, password, name);
    set({ user, fault: null, view: 'onboarding' });
    await get().refreshProfile();
  },

  signOut: async () => {
    await api.signOut();
    set({ user: null, dashboard: null, profile: null, lastResult: null, view: 'home', fault: null });
  },

  go: (view) => set({ view, fault: null }),

  startModule: (pendingModule) => set({ pendingModule, view: 'session', fault: null }),

  refreshDashboard: async () => {
    const user = get().user;
    if (!user || user.role !== 'candidate') return;
    try {
      set({ dashboard: await api.dashboard(), fault: null });
    } catch (err) {
      set({ fault: message(err) });
    }
  },

  refreshProfile: async () => {
    const user = get().user;
    if (!user || user.role !== 'candidate') return;
    try {
      const { profile } = await api.profile();
      set({ profile, fault: null });
    } catch (err) {
      set({ fault: message(err) });
    }
  },

  setResult: (lastResult) => set({ lastResult }),
  setFault: (fault) => set({ fault }),
  clearFault: () => set({ fault: null }),
}));
