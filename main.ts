// Launch Radar v2 — entry point.
//
// Reads the sealed snapshot, ranks every protocol that records no token by
// implied value (lib/radar.ts), and writes the board, the dashboard's data,
// the dashboard, the screenshots and the dossier into the output directory.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
//
// Standard library only; no network; two runs write the same bytes.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, type Snapshot } from './lib/radar.ts';

const root = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

const inputPath = argValue('--input') ?? '/input/snapshot.json';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const radar = buildRadar(snapshot);

mkdirSync(outDir, { recursive: true });

// The board the gate reads: rows ranked by implied value, ranks 1..N.
const board = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  model: 'Launch Radar v2: TVL x measured category multiple x momentum x maturity x reach',
  rows: radar.rows,
};
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(board, null, 1)}\n`);

// The dashboard's data, beside the board: the same rows, the token-bearing
// set the multiples were measured from, and the multiples table itself.
const data = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  global_multiple: radar.global_multiple,
  multiples: radar.multiples,
  rows: radar.rows,
  live: radar.live,
};
writeFileSync(join(outDir, 'data.js'), `window.RADAR_DATA = ${JSON.stringify(data)};\n`);

// Copy the dashboard and the screenshots next to the data.
function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) copyFileSync(src, dst);
  }
}
mkdirSync(outDir, { recursive: true });
if (existsSync(join(root, 'dashboard'))) copyTree(join(root, 'dashboard'), join(outDir, 'dashboard'));
if (existsSync(join(root, 'screenshots'))) copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));

// The dossier the judge reads, written by the kit's own library.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

console.log(`Launch Radar v2: ${radar.rows.length} pre-token protocols ranked, ${radar.live.length} already trading, as of ${snapshot.as_of}.`);
