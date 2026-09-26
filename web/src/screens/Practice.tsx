import { useEffect, useState } from 'react';
import { ArrowRight, Lock } from 'lucide-react';
import { useForge } from '@/store/useForge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export function Practice() {
  const { user, go } = useForge();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(false);
  }, [user]);

  if (loading) {
    return <div className="mx-auto max-w-3xl space-y-3 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-card" />)}</div>;
  }

  if (!user.calibrated) {
    go('onboarding');
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Practise</h1>
        <p className="text-sm text-muted-foreground">Your daily routine is ready.</p>
      </div>

      <Button
        size="lg"
        onClick={() => go('home')}
        disabled={!user.calibrated}
      >
        Start Today’s Routine
        <ArrowRight />
      </Button>
    </div>
  );
}
