import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useForge } from '@/store/useForge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function AuthScreen() {
  const { signIn, signUp, signupAllowed } = useForge();
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

  const signInForm = (
    <div className="space-y-4">
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
    </div>
  );

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
          {!signupAllowed ? (
            // Fixed-account deployment: sign-in only, no registration.
            <CardContent className="space-y-4">
              {signInForm}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
          ) : (
            <Tabs defaultValue="signin">
              <CardHeader>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">Sign in</TabsTrigger>
                  <TabsTrigger value="signup">Create account</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="space-y-4">
                <TabsContent value="signin">{signInForm}</TabsContent>

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
          )}
        </Card>
      </div>
    </div>
  );
}
