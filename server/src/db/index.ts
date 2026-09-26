import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA } from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(here, '../../data/forge.db');

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const path = process.env.FORGE_DB_PATH ?? defaultPath;
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export type Row = Record<string, unknown>;

/** node:sqlite returns null-prototype objects; normalise for JSON transport. */
export function plain<T>(row: unknown): T | null {
  if (row === null || row === undefined) return null;
  return { ...(row as object) } as T;
}

export function plainAll<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as object) }) as T);
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function tx<T>(fn: (d: DatabaseSync) => T): T {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}
