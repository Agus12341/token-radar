// Token Launch Radar — the program (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, runs the model in lib/model.ts, and
// hands in four things: the ranked board (/output/board.json), the data the
// dashboard renders (/output/data.js), the dashboard and screenshots copied
// from this repository, and the dossier the judge reads, written with the
// vendored library in vendor/makefun-board.ts.
//
// The run is a pure function of the snapshot: no clock, no network, no
// randomness, so the grader's two runs write the same bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The scorer's caps, as the kit's reference gate states them. text_max_bytes
// is the one that shapes the dossier; the rest only refuse.
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function argument(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argument('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files across, skipping dot-names; returns the names copied. */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyPlainFiles(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html to hand in');

const shots = copyPlainFiles(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4 (the board, a detail view, a filtered view)`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last: the scorer rebuilds it from this same output and
// compares it byte for byte with what is handed in.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_CAPS));

process.stdout.write(
  `token launch radar: scanned ${radar.scanned} protocols, set ${radar.live_size} token-bearing or product rows aside, ` +
    `ranked ${board.length} pre-token candidates (${radar.early_size} below the $${radar.floor_usd.toLocaleString('en-US')} floor, ` +
    `all ${radar.watchlist_size} watchlist protocols covered), aggregate implied value $${radar.aggregate_implied_usd.toLocaleString('en-US')}\n`,
);
