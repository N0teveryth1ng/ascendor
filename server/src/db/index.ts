import { Pool, types, type PoolClient, type QueryResult } from '@neondatabase/serverless';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SCHEMA } from './schema.js';

/**
 * Postgres access layer.
 *
 * The engine under src/core and src/content is pure computation and knows
 * nothing about storage, so it is unaffected by this swap. Everything that
 * persists lives behind this module and src/db/repo.ts.
 *
 * repo.ts is written against a small `prepare().get()/.all()/.run()` shim that
 * mirrors the node:sqlite API it used previously, so the persistence call sites
 * keep their shape and only gain `await`. Positional `?` markers are rewritten
 * to Postgres `$n` here rather than in every statement.
 */

let pool: Pool | null = null;
let migration: Promise<void> | null = null;

/**
 * The connection currently inside a transaction, if any. Pooled connections are
 * not bound to a request, so a nested `getDb()` would otherwise escape the
 * transaction and run on a different connection. Carrying the active client in
 * async context makes every statement issued during a `tx()` join it, which is
 * what lets repo functions call each other inside a transaction unchanged.
 */
const activeTx = new AsyncLocalStorage<PoolClient>();

/*
 * Restore SQLite's numeric return types.
 *
 * node:sqlite handed back JS numbers for every numeric expression. The Postgres
 * driver deliberately returns `bigint` (OID 20) and `numeric` (OID 1700) as
 * strings to avoid silent precision loss, so every COUNT(*) and AVG() in this
 * codebase would otherwise arrive as a string. That breaks arithmetic and method
 * calls outright: `Number(x.toFixed(2))` throws "toFixed is not a function" on a
 * string, and JSON responses would serialise counts as "16" instead of 16.
 *
 * Parsing both as numbers is safe here. The only bigint columns in the schema are
 * autoincrement surrogate `id`s, which are nowhere near Number.MAX_SAFE_INTEGER,
 * and every business identifier (candidate_id, module_id, session ids) is TEXT.
 * There are no stored `numeric` columns at all; they only arise from AVG() over
 * decimal literals, where a fractional double is the intended result.
 */
types.setTypeParser(20, (v: string) => Number.parseInt(v, 10));
types.setTypeParser(1700, (v: string) => Number.parseFloat(v));

export function getPool(): Pool {
  if (pool) return pool;
  const connection = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connection) {
    throw new Error(
      'DATABASE_URL is not set. Copy server/.env.example to server/.env and set it, ' +
        'or export it before starting the server.',
    );
  }
  pool = new Pool({ connectionString: connection, max: 8 });
  return pool;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
}

/** Rewrite positional `?` markers to Postgres `$1..$n`. */
function bind(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function exec(text: string, params: unknown[]): Promise<QueryResult> {
  const client = activeTx.getStore();
  if (client) return client.query(text, params);
  return getPool().query(text, params);
}

export interface Statement {
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | null>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<void>;
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
}

function dbFor(run: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }>): Db {
  return {
    prepare: (sql: string): Statement => {
      const text = bind(sql);
      return {
        async get<T>(...params: unknown[]): Promise<T | null> {
          const res = await run(text, params);
          return (res.rows[0] as T | undefined) ?? null;
        },
        async all<T>(...params: unknown[]): Promise<T[]> {
          const res = await run(text, params);
          return res.rows as T[];
        },
        async run(...params: unknown[]): Promise<void> {
          await run(text, params);
        },
      };
    },
    exec: async (sql: string) => {
      await run(sql, []);
    },
  };
}

let db: Db | null = null;

export function getDb(): Db {
  if (!db) db = dbFor(exec);
  return db;
}

/**
 * Run `fn` inside a real transaction on one pinned connection, so a
 * multi-statement write either lands completely or not at all. Statements
 * issued by repo functions called from within `fn` join the same transaction.
 */
export async function tx<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query('BEGIN');
    const scoped = dbFor((text, params) => client.query(text, params));
    const out = await activeTx.run(client, () => fn(scoped));
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply the schema once per process. Statements are run independently so that
 * objects which already exist can be skipped rather than aborting the rest.
 */
/**
 * Splits a SQL script into individual statements on semicolons that are actually
 * statement terminators.
 *
 * A plain `split(';')` is wrong: the schema's `--` comments contain semicolons
 * (e.g. "baseline stats are immutable downward. Floors are the
 * calibration-demonstrated values; the only sanctioned..."), so splitting naively
 * cuts a comment in half and sends the leftover English prose to the server,
 * which fails with `syntax error at or near "the"`. This scanner therefore tracks
 * the contexts where a semicolon is NOT a terminator:
 *
 *   - single-quoted literals, with a doubled quote as an escape
 *   - double-quoted identifiers
 *   - line comments, from `--` through end of line
 *   - block comments, which nest in Postgres
 *   - dollar-quoted bodies, tagged or bare
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    // -- line comment
    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    // /* block comment */, which may nest
    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // 'literal' with '' escape
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2;
          else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      continue;
    }

    // "identifier"
    if (ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') i += 2;
          else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      continue;
    }

    // $tag$ ... $tag$ dollar quoting
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? n : close + tag[0].length;
        continue;
      }
    }

    if (ch === ';') {
      const stmt = sql.slice(start, i).trim();
      if (stmt) out.push(stmt);
      i++;
      start = i;
      continue;
    }

    i++;
  }

  const tail = sql.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export async function migrate(): Promise<void> {
  if (migration) return migration;
  migration = (async () => {
    const client: PoolClient = await getPool().connect();
    try {
      for (const sql of splitStatements(SCHEMA)) {
        try {
          await client.query(sql);
        } catch (err) {
          // 42P07/42710 duplicate_object, 42P01 undefined_table: already applied.
          const code = (err as { code?: string }).code;
          if (code === '42P07' || code === '42710' || code === '42P01') continue;
          throw err;
        }
      }
    } finally {
      client.release();
    }
  })();
  return migration;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    db = null;
    migration = null;
    await p.end();
  }
}

export type Row = Record<string, unknown>;

/** node:sqlite returned null-prototype objects; normalise for JSON transport. */
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
