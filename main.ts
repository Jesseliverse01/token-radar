// Token Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <snapshot.json|directory>), scores every rankable pre-token protocol with
// the comparables model in lib/model.ts, and writes the ranked board to
// /output/board.json. The dashboard reads /output/data.js, written from the
// same board, and this program copies dashboard/ and screenshots/ to
// /output, then writes /output/dossier.json with the vendored make.fun
// library. The scorer rebuilds the dossier from /output and compares
// bytes, so this program writes exactly what it reads: no timestamps, no
// randomness, no network.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBoard,
  buildLiveRows,
  categoryMultiples,
  dataScript,
  findInputPath,
  parseAsOf,
  parseSnapshot,
  validateBoard,
  type BoardRow,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(inputFile);
const asOf = parseAsOf(snapshot.as_of);
const multiples = categoryMultiples(snapshot);
const rows = buildBoard(snapshot, asOf, multiples);
const live = buildLiveRows(snapshot, asOf);

const { issues, checks } = validateBoard(rows, snapshot);
if (issues.length > 0) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issues.join('; ')}\n`);
  process.exit(1);
}

// board.json carries the contract and nothing else: slug, name, rank,
// implied value and the farm plan. The dashboard's richer view (TVL,
// change, age, the model's decomposition) lives in data.js, written from
// the same rows, so the page and the board can never disagree.
const boardRows: Pick<BoardRow, 'slug' | 'name' | 'rank' | 'implied_value_usd' | 'farm_steps'>[] = rows.map(
  (r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }),
);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(rows, live, multiples, snapshot));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const watchlistRows = rows.filter((r) => snapshot.watchlist.includes(r.slug)).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows scored (${watchlistRows} watchlist, ${rows.length - watchlistRows} outside it), ${live.length} live comparables shown\n` +
    `token radar: gate ${Object.entries(checks)
      .map(([k, v]) => `${k}=${v ? 'pass' : 'fail'}`)
      .join(' ')}\n` +
    `token radar: top ${rows[0].name} $${rows[0].implied_value_usd.toLocaleString('en-US')} · #${rows.length} ${rows[rows.length - 1].name} $${rows[rows.length - 1].implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
