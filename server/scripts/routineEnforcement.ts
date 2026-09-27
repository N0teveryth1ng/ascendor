/**
 * Section 16.1 — the client cannot choose a module.
 *
 * The UI picker was removed, but that proves nothing on its own: a candidate who
 * reads the network log can still ask for `?module=P1_VD` directly, and a future
 * UI change could reintroduce the link without anyone noticing. So this asserts
 * the server refuses, for every module it advertises.
 *
 * Three outcomes are acceptable and only three: the request is refused, or it
 * returns the same routine as a no-param request. Anything else — a 200 carrying
 * a single-module payload — is a failure, which is exactly what a silent
 * "ignore the param" implementation would produce.
 */
import { ALL_MODULE_IDS } from '../src/core/modules.js';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.E2E_EMAIL ?? 'billi@forge.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function signin(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`signin failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('signin returned no cookie');
  return cookie.split(';')[0]!;
}

const get = (path: string, cookie: string) => fetch(`${BASE}${path}`, { headers: { cookie } });

async function main(): Promise<void> {
  if (!PASSWORD) throw new Error('E2E_PASSWORD must be set.');
  const cookie = await signin();

  // With no PCP the gate answers 423 before any of this matters. Calibrate
  // first, otherwise every assertion below would pass for the wrong reason.
  const pcpProbe = await get('/api/routine', cookie);
  if (pcpProbe.status === 423) {
    console.log('  SKIP  candidate has no PCP; 423 would mask a real bypass. Calibrate first.');
    console.log('\n0 checks — nothing was actually proven.');
    process.exitCode = 1;
    return;
  }
  check('routine reachable for a calibrated candidate', pcpProbe.status === 200, `got ${pcpProbe.status}`);
  const baseline = await pcpProbe.json();

  // The baseline is what a no-param request returns. Every module-parameterised
  // request must either be refused or be byte-identical to this.
  const baselineText = JSON.stringify(baseline);

  for (const moduleId of ALL_MODULE_IDS) {
    const res = await get(`/api/session/next?module=${moduleId}`, cookie);
    const text = await res.text();

    if (res.status === 400 || res.status === 404) {
      check(`session/next?module=${moduleId} refused`, true);
      continue;
    }
    if (res.status !== 200) {
      check(`session/next?module=${moduleId} refused`, false, `unexpected ${res.status}: ${text.slice(0, 120)}`);
      continue;
    }

    // 200: legal only if it is the same routine, not a single-module plan.
    const body = JSON.parse(text) as { routine?: unknown; module?: { module_id?: string } };
    if (!body.routine) {
      check(
        `session/next?module=${moduleId} returns no single-module plan`,
        false,
        `200 with a plan for ${body.module?.module_id ?? 'unknown'} — selection still honoured`,
      );
      continue;
    }
    check(
      `session/next?module=${moduleId} returns the full routine`,
      text === baselineText || JSON.stringify(body.routine) === JSON.stringify((baseline as { routine: unknown }).routine),
      'routine payload differs from the no-param request',
    );
  }

  // The routine itself must be a fixed shape the client cannot reshape: one
  // step per block, in block order, and every eligible module bound somewhere.
  const routine = (baseline as { routine?: { steps?: { block: string; modules: { module_id: string }[] }[] } }).routine;
  if (routine?.steps) {
    const blocks = routine.steps.map((s) => s.block);
    check(
      'routine follows the fixed block order',
      JSON.stringify(blocks) === JSON.stringify(['VOCAL', 'VECTOR', 'DICTATION', 'VISUOSPATIAL']),
      `got ${JSON.stringify(blocks)}`,
    );
    const bound = routine.steps.flatMap((s) => s.modules.map((m) => m.module_id));
    check(
      'routine binds each module to exactly one block',
      new Set(bound).size === bound.length,
      `duplicate binding: ${JSON.stringify(bound)}`,
    );
    check(
      'no block is empty once a candidate is calibrated',
      routine.steps.every((s) => s.modules.length > 0),
      'a block was served with zero modules',
    );
  }

  // Submit must not accept a caller-named module either.
  //
  // The probe sends an empty attempts[] on purpose: that guarantees a 400 before
  // the engine is ever reached, so running this against production cannot
  // create a session row. The cost is that a bare "status >= 400" assertion
  // would pass on the empty-attempts error and prove nothing, so the refusal is
  // matched against the module-parameter message specifically. The unit test
  // covers rejectModuleParam itself for all 9 ids.
  for (const moduleId of ALL_MODULE_IDS) {
    const res = await fetch(`${BASE}/api/session`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ module_id: moduleId, attempts: [] }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const refused =
      res.status === 400 && /module/i.test(body.error ?? '') && !/attempts/i.test(body.error ?? '');
    check(
      `POST /session with module_id=${moduleId} refused the module`,
      refused,
      `got ${res.status}: ${(body.error ?? '').slice(0, 140)}`,
    );
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log('SECTION 16.1 FAILED — module selection is still reachable.');
    process.exitCode = 1;
  } else {
    console.log('Section 16.1 verified: no route serves a module by name.');
  }
}

main().catch((err: unknown) => {
  console.error(`[E2E] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
