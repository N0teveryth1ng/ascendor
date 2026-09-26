import { useEffect } from 'react';
import { BarChart3, History, Home, LogOut, PlayCircle, Sparkles, Users } from 'lucide-react';
import { useForge, type View } from '@/store/useForge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthScreen } from '@/screens/Auth';
import { Home as HomeScreen } from '@/screens/Home';
import { Progress } from '@/screens/Progress';
import { Practice } from '@/screens/Practice';
import { Onboarding } from '@/screens/Onboarding';
import { SessionRunner } from '@/screens/SessionRunner';
import { Teacher } from '@/screens/Teacher';
import { History as HistoryScreen } from '@/screens/History';
import { cn } from '@/lib/utils';

const CANDIDATE_NAV: { view: View; label: string; icon: typeof Home }[] = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'practice', label: 'Practise', icon: PlayCircle },
  { view: 'progress', label: 'Progress', icon: BarChart3 },
  { view: 'history', label: 'History', icon: History },
];

export default function App() {
  const { user, view, boot, booting, signOut } = useForge();

  useEffect(() => {
    void boot();
  }, [boot]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>
    );
  }

  if (!user) {
    return (
      <TooltipProvider delayDuration={200}>
        <AuthScreen />
      </TooltipProvider>
    );
  }

  if (user.role === 'admin') return <Teacher />;

  const showChrome = view !== 'session' && view !== 'onboarding';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen">
        {showChrome && <Header onSignOut={() => void signOut()} />}

        <main className={showChrome ? 'pb-20' : undefined}>
          {view === 'home' && <HomeScreen />}
          {view === 'progress' && <Progress />}
          {view === 'history' && <HistoryScreen />}
          {view === 'practice' && <Practice />}
          {view === 'onboarding' && <Onboarding />}
          {view === 'session' && <SessionRunner />}
        </main>

        {showChrome && <Nav />}
      </div>
    </TooltipProvider>
  );
}

function Header({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useForge();
  if (!user) return null;
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">The Forge</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">{user.email}</span>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials(user.display_name)}</AvatarFallback>
          </Avatar>
          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={onSignOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function Nav() {
  const { view, go } = useForge();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-stretch justify-around px-4">
        {CANDIDATE_NAV.map(({ view: v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => go(v)}
            aria-current={view === v ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors',
              view === v ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => go('onboarding')}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors',
            view === 'onboarding' ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Users className="h-5 w-5" />
          Setup
        </button>
      </div>
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
