/**
 * Audit: find calls to functions that became `async` during the Postgres port
 * whose returned promise is discarded. TypeScript cannot catch these - dropping
 * a Promise is legal - so they have to be looked for explicitly.
 *
 * Verified against planted probes: a statement-position call is reported, while
 * `await`, `return`, `void`, `Promise.all`, and a promise assigned then awaited
 * are not.
 *
 * Known limitation: this only sees *exported* async functions. Un-awaited
 * `.run()` / `.get()` / `.all()` on the DB shim, and a non-async function doing
 * async work internally, are both invisible here - the shim's method names are
 * too common (`Map.get`, Express `router.get`) to match safely. Those call sites
 * were reviewed by hand; see the audit note in the Neon port commit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const roots = ['server/src', 'server/scripts'];

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p);
  }
};
roots.forEach(walk);

/** Names of every `export async function` and `export const x = async`. */
const asyncNames = new Set();
for (const p of files) {
  const t = readFileSync(p, 'utf8');
  for (const m of t.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)) asyncNames.add(m[1]);
  for (const m of t.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*async/g)) asyncNames.add(m[1]);
}

const names = [...asyncNames].sort((a, b) => b.length - a.length);
const callRe = new RegExp(`(?<![.\\w$])(${names.join('|')})\\s*\\(`, 'g');

const findings = [];
for (const p of files) {
  const text = readFileSync(p, 'utf8');
  // Positions that sit inside a string or comment. A bare `name(` inside a string
  // literal is not a call site at all, and reporting one buries the real findings
  // behind noise. Scanned once per file and indexed by absolute offset.
  const literal = new Uint8Array(text.length);
  {
    let i = 0;
    let quote = null; // active string delimiter, if any
    let block = false;
    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];
      if (block) {
        literal[i] = 1;
        if (c === '*' && next === '/') {
          literal[i + 1] = 1;
          i += 2;
          block = false;
          continue;
        }
        i++;
        continue;
      }
      if (quote) {
        literal[i] = 1;
        if (c === '\\') {
          literal[i + 1] = 1;
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        i++;
        continue;
      }
      if (c === '/' && next === '/') {
        // Line comment: mark the rest of the line.
        while (i < text.length && text[i] !== '\n') literal[i++] = 1;
        continue;
      }
      if (c === '/' && next === '*') {
        literal[i] = 1;
        literal[i + 1] = 1;
        i += 2;
        block = true;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        literal[i] = 1;
        quote = c;
        i++;
        continue;
      }
      i++;
    }
  }
  // Line starts, so an absolute index can be reported as file:line.
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const lineText = (n) => text.slice(lineStarts[n - 1], (lineStarts[n] ?? text.length) - 1);

  callRe.lastIndex = 0;
  let m;
  while ((m = callRe.exec(text)) !== null) {
    const index = m.index;
    const label = `${m[1]}()`;
    const idx = index;
    const before = text.slice(0, idx);
    const line = lineText(lineOf(idx));
    // Only the text preceding this call on its own line. Testing the whole line
    // would wrongly discard a real call that happens to sit on a line which also
    // contains a declaration, e.g. a one-line `function f() { g(); }`.
    const lineStart = before.lastIndexOf('\n') + 1;
    const head = text.slice(lineStart, idx);

    // Skip comments.
    if (/^\s*(\/\/|\*|\/\*)/.test(head)) continue;

    // Skip string and comment literals, where `name(` is prose, not a call.
    if (literal[idx]) continue;

    // Consuming positions: awaited, returned, voided, assigned, passed as an
    // argument, or an element of Promise.all([...]) / Promise.all(xs.map(...)).
    if (/\b(await|return|void)\s+$/.test(before)) continue;
    if (/[=(:,[]\s*$/.test(before)) continue;
    if (/Promise\s*\.\s*all\s*\(/.test(before.slice(before.lastIndexOf(';') + 1))) continue;

    // Declaration / import sites: the call *is* the declaration.
    if (/^\s*(export\s+)?(async\s+)?function\s*$/.test(head)) continue;
    if (/^\s*import\s*$/.test(head)) continue;
    // Interface / type method signature, detected from the text after the call:
    // `prepare(sql: string): Statement;` and `prepare(sql: string): Statement {`.
    if (/^\s*(readonly\s+)?[A-Za-z0-9_]+\s*\(/.test(line) && /\)\s*:\s*[A-Za-z0-9_<>[\]|, .]+\s*[;{]\s*$/.test(line)) continue;
    // `foo` on the left of an assignment/declaration is a reference, not a call.
    if (/^\s*(export\s+)?(const|let|var)\s+[A-Za-z0-9_]+\s*=\s*$/.test(head)) continue;

    findings.push(`${relative('.', p)}:${lineOf(idx)}  ${label}  |  ${line.trim()}`);
  }
}

if (findings.length === 0) {
  console.log(`OK: no discarded promises (${asyncNames.size} async fns, ${files.length} files)`);
} else {
  console.log(`${findings.length} potentially discarded promise(s):`);
  for (const f of findings) console.log('  ' + f);
}
