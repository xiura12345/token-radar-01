// Launch Radar: the token-radar-01 entry program (Node 22, standard library only).
//
// It reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), runs the
// comparable-multiple model in lib/model.ts over every pre-token protocol, and writes
// the deliverables the grader reads into /output:
//
//   board.json    the ranked board (watchlist covered, ranks 1..N by implied value)
//   data.js       the same radar as one script, which the dashboard renders from
//   dashboard/    this repository's static page (no network, no framework)
//   screenshots/  three renders of that page: the board, a detail view, a filtered view
//   dossier.json  the judge's summary, written by vendor/makefun-board.ts from the above
//
// The board is validated against the gate's own rules before anything is written: a
// board the gate would refuse fails the run instead of reaching the scorer. Both grader
// runs read the same sealed bytes and this program consults no clock, no randomness and
// no environment beyond the output directory, so the two runs write identical files.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps, as the gate states them: the dossier text cap and the image caps. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launch radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board, model_version: radar.model_version, as_of: snapshot.as_of })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/**
 * Copy a directory tree of regular files into `to`, skipping any name that starts with a
 * dot (the gate reads only plain names). Returns the relative paths copied.
 */
function copyTree(from: string, to: string, prefix = ''): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(src).isDirectory()) {
      copied.push(...copyTree(src, join(to, name), rel));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, join(to, name));
      copied.push(rel);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashFiles.includes('index.html') || !dashFiles.some((f) => f.endsWith('.css')) || !dashFiles.some((f) => f.endsWith('.js'))) {
  process.stderr.write('launch radar: dashboard/ must hold index.html and at least one .css and one .js file\n');
  process.exit(1);
}
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`launch radar: screenshots/ holds ${shots.length} images: hand in 3 or 4 (the board, a detail view, a filtered view)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`launch radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, never starting with . or -\n`);
    process.exit(1);
  }
}

// Written last: the scorer rebuilds the dossier from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols (${radar.counts.pre_token} pre-token, ${radar.counts.live} already trading), ` +
    `watchlist ${snapshot.watchlist.length}, board ${board.length} rows (${radar.counts.early} early finds below the floor)\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json under ${out}\n`,
);
