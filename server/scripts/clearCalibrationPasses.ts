/**
 * Clears Calibration C1 pass rows for one candidate.
 *
 * Scoped deliberately: candidate_id + vector + pass_type only. No truncate, no
 * table-wide delete, so nothing outside the C1 evidence for this candidate can
 * be touched by a mistake in an argument. The ids are printed before the
 * delete so the blast radius is on the record, and the delete is a single
 * statement so it either lands completely or not at all.
 *
 * Usage: npx tsx scripts/clearCalibrationPasses.ts <candidate_id> [vector] [pass_type]
 *   e.g. npx tsx scripts/clearCalibrationPasses.ts billi C1
 */
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set; refusing to run without an explicit target');
const sql = neon(url);

const candidateId = process.argv[2];
if (!candidateId) throw new Error('candidate_id is required');
const vector = process.argv[3] ?? null;
const passType = process.argv[4] ?? null;

const exists = await sql`SELECT 1 FROM candidates WHERE candidate_id = ${candidateId}`;
if (exists.length === 0) throw new Error(`no such candidate: ${candidateId}`);

const before = await sql`
  SELECT id, vector, pass_type, accuracy_pct, details
  FROM calibration_passes
  WHERE candidate_id = ${candidateId}
    AND (${vector}::text IS NULL OR vector = ${vector})
    AND (${passType}::text IS NULL OR pass_type = ${passType})
  ORDER BY id`;

console.log(`target: candidate=${candidateId} vector=${vector ?? 'ANY'} pass_type=${passType ?? 'ANY'}`);
console.log(`rows to delete: ${before.length}`);
for (const r of before) console.log(`  #${r.id} ${r.vector}/${r.pass_type} acc=${r.accuracy_pct}`);

if (before.length === 0) {
  console.log('nothing to do');
  process.exit(0);
}

const ids = before.map((r) => r.id as number);
// One statement, so it is atomic on its own: either the rows go or none do.
// The ids are listed first so the blast radius is on the record before it
// happens, and the reads below are verification, not part of the delete.
const deleted = await sql`
  DELETE FROM calibration_passes
  WHERE candidate_id = ${candidateId}
    AND id = ANY(${ids}::int[])
  RETURNING id`;

const after = await sql`
  SELECT count(*)::int AS n FROM calibration_passes
  WHERE candidate_id = ${candidateId}
    AND (${vector}::text IS NULL OR vector = ${vector})
    AND (${passType}::text IS NULL OR pass_type = ${passType})`;

console.log(`\ndeleted ${deleted.length} row(s): ${deleted.map((d) => '#' + d.id).join(', ')}`);
console.log(`remaining matching rows: ${after[0]!.n}`);

const total = await sql`SELECT candidate_id, count(*)::int AS n FROM calibration_passes GROUP BY candidate_id`;
console.log('\ncalibration_passes by candidate:');
if (total.length === 0) console.log('  (empty)');
for (const t of total) console.log(`  ${t.candidate_id}: ${t.n}`);
