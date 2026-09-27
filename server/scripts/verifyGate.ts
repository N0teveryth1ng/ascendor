/**
 * Verifies the Section 14 / calibration-gate acceptance criteria against the
 * live deployment, for both fixed candidate accounts.
 *
 * The point is to prove the gate from the outside: that an uncalibrated
 * candidate cannot obtain a drill item from any route, including the ones the
 * UI happens not to link to. Read-only.
 *
 * Run: node --import tsx scripts/verifyGate.ts <baseUrl> [passwordFile]
 */
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'https://the-forge-amber-eight.vercel.app';
const credFile = process.argv[3] ?? `${process.env.TEMP}\\forge-creds.txt`;

function passwordFor(label: string): string {
  const text = readFileSync(credFile, 'utf8');
  const m = text.match(new RegExp(`^${label}\\s*[=:]\\s*(.+)$`, 'm'));
  if (!m) throw new Error(`no ${label} in ${credFile}`);
  return m[1]!.trim();
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} -> ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error(`login ${email} returned no cookie`);
  return cookie.split(';')[0]!;
}

// The module list is read from the server rather than hardcoded, so this cannot
// quietly "pass" by testing ids that no longer exist (which return 400, not the
// 423 the gate is supposed to produce).
const meta = (await (await fetch(`${base}/api/meta`)).json()) as { modules: { id: string }[] };
const MODULES = meta.modules.map((m) => m.id);
console.log(`modules under test (${MODULES.length}): ${MODULES.join(', ')}\n`);

const p1 = passwordFor('CANDIDATE_ONE_PASSWORD');
const p2 = passwordFor('CANDIDATE_TWO_PASSWORD');

for (const [email, password] of [
  ['billi@forge.local', p1],
  ['anik@forge.local', p2],
] as const) {
  console.log(`\n=== ${email} ===`);
  const cookie = await login(email, password);

  const prof = await fetch(`${base}/api/profile`, { headers: { cookie } });
  const body = (await prof.json()) as { profile?: Record<string, unknown>; sessions?: unknown[]; modules?: unknown[] };
  const p = body.profile ?? {};
  console.log(`  /api/profile        ${prof.status}`);
  console.log(`    calibrated=${String(p.calibrated)} rank=${JSON.stringify(p.rank)} entry_rank=${JSON.stringify(p.entry_rank)}`);
  console.log(`    sessions=${Array.isArray(body.sessions) ? body.sessions.length : '?'} modules=${Array.isArray(body.modules) ? body.modules.length : '?'}`);

  // Every route that can serve a drill item must refuse without a PCP. If any
  // returns 200 the gate has a hole, regardless of what the UI renders.
  for (const mod of MODULES) {
    const r = await fetch(`${base}/api/session/next?module=${mod}`, { headers: { cookie } });
    const text = await r.text();
    if (r.status !== 423) {
      console.log(`  FAIL /api/session/next?module=${mod} -> ${r.status} ${text.slice(0, 120)}`);
    }
  }
  const probe = await fetch(`${base}/api/session/next?module=${MODULES[0]}`, { headers: { cookie } });
  const probeBody = await probe.text();
  console.log(`  /api/session/next   ${probe.status}  ${probeBody.slice(0, 80)}`);

  // The calibration battery must still be reachable — it is what produces the PCP.
  const batt = await fetch(`${base}/api/calibration/battery`, { headers: { cookie } });
  console.log(`  /api/calibration/battery  ${batt.status}  (must NOT be 423)`);
}
