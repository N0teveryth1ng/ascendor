import { convergeSeededAccount } from './auth.js';

interface SeedAccount {
  id: string;
  email: string;
  password: string;
  display_name: string;
  role: 'candidate' | 'admin';
}

/**
 * Section 13.3. Two candidate tracks and one teacher account.
 *
 * Two modes:
 *
 * 1. `FIXED_ACCOUNTS=1` (production). Exactly two candidate accounts plus one
 *    teacher are created from the environment. Passwords are *only* read from
 *    the environment and never fall back to a committed default, so the
 *    repository can never contain a working login. Public signup is refused
 *    while this is on, which is what makes the two accounts isolated: there
 *    is no third candidate.
 *
 * 2. `SEED_DEMO=1` (local dev, CI fixtures, demos). The well-known demo
 *    passwords below are used so `npm run dev` works out of the box. This must
 *    never be enabled on a public deployment.
 *
 * Both are idempotent: accounts are only created when missing, so restarts
 * never clobber real accounts or reset progress.
 */
const DEMO_PASSWORDS = {
  billi: 'billi-demo-2024',
  anik: 'anik-demo-2024',
  teacher: 'teacher-demo-2024',
} as const;

function demoPassword(id: keyof typeof DEMO_PASSWORDS): string {
  return process.env[`DEMO_PASSWORD_${id.toUpperCase()}`] ?? DEMO_PASSWORDS[id];
}

export const SEED_ACCOUNTS: SeedAccount[] = [
  { id: 'billi', email: 'billi@forge.local', password: demoPassword('billi'), display_name: 'Billi', role: 'candidate' },
  { id: 'anik', email: 'anik@forge.local', password: demoPassword('anik'), display_name: 'Anik', role: 'candidate' },
  { id: 'teacher', email: 'teacher@forge.local', password: demoPassword('teacher'), display_name: 'Teacher', role: 'admin' },
];

export function demoSeedEnabled(): boolean {
  return process.env.SEED_DEMO === '1' || process.env.SEED_DEMO === 'true';
}

/**
 * Production mode. On, public signup is closed and the candidate roster is
 * fixed at exactly two.
 */
export function fixedAccountsEnabled(): boolean {
  return process.env.FIXED_ACCOUNTS === '1' || process.env.FIXED_ACCOUNTS === 'true';
}

export function signupAllowed(): boolean {
  // Fixed-account deployments refuse new accounts; otherwise signup is open.
  return !fixedAccountsEnabled();
}

interface FixedSpec {
  prefix: 'CANDIDATE_ONE' | 'CANDIDATE_TWO' | 'ADMIN';
  id: string;
  role: 'candidate' | 'admin';
  fallbackName: string;
}

/**
 * Reads the two candidates and the teacher from the environment. Returns null
 * (and warns) when a required variable is missing, so a misconfigured
 * deployment fails loudly instead of silently seeding nothing.
 */
export function fixedAccounts(): SeedAccount[] | null {
  const specs: FixedSpec[] = [
    { prefix: 'CANDIDATE_ONE', id: 'billi', role: 'candidate', fallbackName: 'Billi' },
    { prefix: 'CANDIDATE_TWO', id: 'anik', role: 'candidate', fallbackName: 'Anik' },
    { prefix: 'ADMIN', id: 'teacher', role: 'admin', fallbackName: 'Teacher' },
  ];

  const accounts: SeedAccount[] = [];
  const missing: string[] = [];

  for (const spec of specs) {
    const email = process.env[`${spec.prefix}_EMAIL`]?.trim();
    const password = process.env[`${spec.prefix}_PASSWORD`];
    if (!email || !password) {
      missing.push(`${spec.prefix}_EMAIL / ${spec.prefix}_PASSWORD`);
      continue;
    }
    accounts.push({
      id: spec.id,
      email,
      password,
      display_name: process.env[`${spec.prefix}_NAME`]?.trim() || spec.fallbackName,
      role: spec.role,
    });
  }

  if (missing.length > 0) {
    console.error(
      `[FORGE] FIXED_ACCOUNTS=1 but these are unset, so no fixed accounts were seeded: ${missing.join(', ')}`,
    );
    return null;
  }
  return accounts;
}

export async function seedAccounts(): Promise<void> {
  const accounts = fixedAccountsEnabled() ? fixedAccounts() : demoSeedEnabled() ? SEED_ACCOUNTS : null;
  if (!accounts) return;

  for (const account of accounts) {
    try {
      // Converge rather than create-once. A fixed account that already exists
      // must still pick up the current environment, or the credentials in the
      // environment are silently ignored and signin fails with a 401 that looks
      // like a wrong password. This bites whenever the same database was seeded
      // earlier as a demo or by a previous deploy with different values.
      const changed = await convergeSeededAccount(account);
      if (changed) {
        console.log(`[FORGE] seeded ${account.role} account ${account.id} <${account.email}>`);
      }
    } catch (err) {
      console.error(`[FORGE] failed to seed ${account.id}:`, err instanceof Error ? err.message : err);
    }
  }
}
