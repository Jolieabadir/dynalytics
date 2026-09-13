/**
 * Regenerate the golden pose CSV.
 *
 * Run: npm run make-golden
 *
 * The golden file pins the exact bytes framesToCSV produces for a fixed set of
 * frames. Regenerate it ONLY when the column contract is meant to change, and
 * review the diff — an unexpected change here means the contract moved under
 * something downstream.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { framesToCSV, csvHeaders } from '../src/services/poseMath.js';
import { goldenFrames, GOLDEN_META } from './golden_frames.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const target = join(HERE, 'fixtures', 'golden_pose.csv');

const csv = framesToCSV(goldenFrames());
writeFileSync(target, csv, 'utf8');

const lines = csv.split('\n');
console.log(`Wrote ${target}`);
console.log(`  columns: ${csvHeaders().length}`);
console.log(`  landmarks: ${GOLDEN_META.landmarkCount}`);
console.log(`  rows: ${lines.length - 1} (+1 header)`);
console.log(`  bytes: ${csv.length}`);
