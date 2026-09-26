import { getDb } from '../db/index.js';
import { createUser, findUserById } from './auth.js';

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
 * These are well-known credentials, so they are opt-in: a public deployment
 * must never come up with a working admin login nobody chose. Set
 * `SEED_DEMO=1` to create them (local dev, CI fixtures, demos).
 *
 * Seeded only when missing, so restarts never clobber real accounts or reset
 * progress. Passwords can be overridden from the environment for shared
 * environments rather than trusting the ones committed here.
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

export function seedAccounts(): void {
  getDb();
  if (!demoSeedEnabled()) return;
  for (const account of SEED_ACCOUNTS) {
    if (findUserById(account.id)) continue;
    try {
      createUser(account);
      console.log(`[FORGE] seeded demo account ${account.id} (${account.role})`);
    } catch (err) {
      console.error(`[FORGE] failed to seed ${account.id}:`, err instanceof Error ? err.message : err);
    }
  }
}
