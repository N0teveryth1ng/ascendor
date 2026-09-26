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
 * Section 13.3. Two candidate tracks and one teacher account. Seeded only when
 * missing, so restarts never clobber real accounts or reset progress.
 */
export const SEED_ACCOUNTS: SeedAccount[] = [
  { id: 'billi', email: 'billi@forge.local', password: 'billi-demo-2024', display_name: 'Billi', role: 'candidate' },
  { id: 'anik', email: 'anik@forge.local', password: 'anik-demo-2024', display_name: 'Anik', role: 'candidate' },
  { id: 'teacher', email: 'teacher@forge.local', password: 'teacher-demo-2024', display_name: 'Teacher', role: 'admin' },
];

export function seedAccounts(): void {
  getDb();
  for (const account of SEED_ACCOUNTS) {
    if (findUserById(account.id)) continue;
    try {
      createUser(account);
      console.log(`[FORGE] seeded account ${account.id} (${account.role})`);
    } catch (err) {
      console.error(`[FORGE] failed to seed ${account.id}:`, err instanceof Error ? err.message : err);
    }
  }
}
