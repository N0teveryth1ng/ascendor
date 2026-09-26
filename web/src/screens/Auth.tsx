import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useForge } from '@/store/useForge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const DEMO = [
  { label: 'Billi', email: 'billi@forge.local', password: 'billi-demo-2024' },
  { label: 'Anik', email: 'anik@forge.local', password: 'anik-demo-2024' },
  { label: 'Teacher', email: 'teacher@forge.local', password: 'teacher-demo-2024' },
];

export function AuthScreen() {
  const { signIn, signUp } = useForge();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">The Forge</h1>
          <p className="text-sm text-muted-foreground">
            Adaptive language training that meets you where you are.
          </p>
        </div>

        <Card>
          <Tabs defaultValue="signin">
            <CardHeader>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="space-y-4">
              <TabsContent value="signin" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="si-email">Email</Label>
                  <Input
                    id="si-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="si-password">Password</Label>
                  <Input
                    id="si-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && email && password) void run(() => signIn(email, password));
                    }}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy || !email || !password}
                  onClick={() => run(() => signIn(email, password))}
                >
                  {busy && <Loader2 className="animate-spin" />}
                  Sign in
                </Button>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="su-name">Your name</Label>
                  <Input
                    id="su-name"
                    placeholder="What should we call you?"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-email">Email</Label>
                  <Input
                    id="su-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-password">Password</Label>
                  <Input
                    id="su-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy || !email || !password || !name}
                  onClick={() => run(() => signUp(email, password, name))}
                >
                  {busy && <Loader2 className="animate-spin" />}
                  Create account
                </Button>
              </TabsContent>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
          </Tabs>
        </Card>

        <Card className="bg-secondary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Demo accounts</CardTitle>
            <CardDescription className="text-xs">Tap one to fill the form.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                }}
              >
                <span className="text-sm font-medium">{d.label}</span>
                <span className="text-xs text-muted-foreground">{d.email}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
