/**
 * Point 5 of the C1 audit: prove whether either fixed account has a recorded
 * calibration pass against the broken content, before any of it is overwritten.
 *
 * Read-only. Takes DATABASE_URL from the environment; never accepts it as an
 * argument, so it cannot end up in a shell history or a process listing.
 */
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = neon(url);
console.log(`connected: ${new URL(url).hostname}\n`);

const cands = await sql`
  SELECT candidate_id, display_name FROM candidates ORDER BY candidate_id`;
console.log('candidates:');
for (const c of cands) console.log(`   ${c.candidate_id}  ${c.display_name ?? ''}`);

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name`;
console.log('tables:', tables.map((t) => t.table_name).join(', '));

const pcpRows = await sql`SELECT candidate_id FROM pcp`;
console.log(`\npcp rows: ${pcpRows.length}`);

const n = await sql`SELECT count(*)::int AS n FROM calibration_passes`;
console.log(`\ncalibration_passes rows: ${n[0]!.n}`);

if (n[0]!.n > 0) {
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'calibration_passes' ORDER BY ordinal_position`;
  console.log('\ncalibration_passes columns:', cols.map((c) => c.column_name).join(', '));
  const rows = await sql`SELECT * FROM calibration_passes ORDER BY id`;
  console.log('');
  for (const r of rows) {
    const row = r as Record<string, unknown>;
    const details = typeof row.details === 'string' ? row.details : JSON.stringify(row.details);
    // The question that matters: does any C1 pass carry band keys that are not
    // real vocabulary bands?
    let bandKeys: string[] = [];
    try {
      const d = JSON.parse(details as string) as { band_accuracy?: Record<string, number> | null };
      bandKeys = Object.keys(d.band_accuracy ?? {});
    } catch {
      bandKeys = ['<unparseable>'];
    }
    console.log(
      `  #${row.id} ${row.candidate_id} ${row.vector}/${row.pass_type} ` +
        `acc=${Number(row.accuracy_pct).toFixed(1)}% band_keys=${JSON.stringify(bandKeys)}`,
    );
  }
  const bad = await sql`
    SELECT id, candidate_id, vector, pass_type, details FROM calibration_passes
    WHERE vector = 'C1'`;
  let corrupt = 0;
  for (const b of bad) {
    const d = b.details as Record<string, unknown>;
    const text = typeof d === 'string' ? d : JSON.stringify(d);
    const keys = Object.keys(
      (typeof text === 'string' ? (JSON.parse(text) as { band_accuracy?: object }).band_accuracy ?? {} : {}) as object,
    );
    const real = keys.length > 0 && keys.every((k) => /^V([1-9]|1[0-2])$/.test(k));
    if (!real) {
      corrupt += 1;
      console.log(`  CORRUPT C1 pass #${b.id} for ${b.candidate_id}: band keys ${JSON.stringify(keys)}`);
    }
  }
  console.log(`\nC1 passes with non-band keys: ${corrupt}`);
} else {
  console.log('\nNo calibration pass has ever been recorded. Nothing to clear.');
}
