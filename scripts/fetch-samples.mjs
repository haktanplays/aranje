/**
 * Downloads the sample set into public/samples and writes the manifest.
 *
 * Source: gleitz/midi-js-soundfonts, FluidR3_GM, pre-rendered per-note MP3.
 * That repository states FluidR3_GM is released under CC BY 3.0, so that is
 * the licence recorded here. It is NOT the MIT-documented FluidR3 Mono package
 * shipped by Debian; the licence follows the source the files actually came
 * from (spec 7.3).
 *
 * Run: node scripts/fetch-samples.mjs
 * The downloaded files are committed, so the app never fetches from a third
 * party at runtime (spec 7.2).
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const BASE =
  "https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM";

/*
 * The source README states FluidR3_GM is "Released under Creative Commons
 * Attribution 3.0 license" and links to the United States port, so that exact
 * port is what is recorded. The full legal text is not vendored yet because
 * creativecommons.org is unreachable from this environment; see
 * public/samples/licenses/NOTICE.md.
 */
const LICENSE = {
  spdx: "CC-BY-3.0-US",
  name: "Creative Commons Attribution 3.0 United States",
  url: "https://creativecommons.org/licenses/by/3.0/us/",
  textPath: "/samples/licenses/NOTICE.md",
  textVendored: false,
  attribution:
    "Contains samples from the FluidR3_GM soundfont by Frank Wen, " +
    "pre-rendered by gleitz/midi-js-soundfonts, licensed under CC BY 3.0 US.",
  sourceRepository: "https://github.com/gleitz/midi-js-soundfonts",
  sourceStatement:
    "https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/master/README.md",
  soundfont: "FluidR3_GM.sf2",
  note:
    "Taken from midi-js-soundfonts, not from the MIT-documented FluidR3 Mono " +
    "package in Debian. The licence follows the source the files came from.",
};

/** Sparse note sets; Tone.Sampler pitch-shifts what lies between (spec 13.2). */
const PACKS = [
  {
    id: "electric_guitar/high_gain",
    source: "distortion_guitar",
    notes: ["E2", "A2", "C3", "E3", "A3", "C4", "E4"],
  },
  {
    id: "steel_acoustic/finger",
    source: "acoustic_guitar_steel",
    notes: ["E2", "A2", "C3", "E3", "A3", "C4", "E4", "A4"],
  },
  {
    id: "electric_bass/finger",
    source: "electric_bass_finger",
    notes: ["E1", "A1", "C2", "E2", "A2", "C3"],
  },
];

const ROOT = new URL("../public/samples/", import.meta.url).pathname;

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function writeFileEnsuringDir(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

const manifest = { license: LICENSE, packs: [] };
let total = 0;

for (const pack of PACKS) {
  const files = [];
  for (const note of pack.notes) {
    const originalFileName = `${note}.mp3`;
    const url = `${BASE}/${pack.source}-mp3/${originalFileName}`;
    const data = await get(url);
    const target = join(ROOT, pack.id, originalFileName);
    await writeFileEnsuringDir(target, data);

    total += data.byteLength;
    files.push({
      note,
      originalFileName,
      processedFileName: originalFileName,
      sourceUrl: url,
      bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
    process.stdout.write(`${pack.id}/${originalFileName} ${data.byteLength}B\n`);
  }
  manifest.packs.push({
    id: pack.id,
    instrumentSource: pack.source,
    baseUrl: `/samples/${pack.id}`,
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  });
}

const licenseText = await get(`${LICENSE.url}legalcode.txt`).catch(() => null);
if (licenseText) {
  await writeFileEnsuringDir(
    join(ROOT, "licenses/CC-BY-3.0-US.txt"),
    licenseText,
  );
  manifest.license.textPath = "/samples/licenses/CC-BY-3.0-US.txt";
  manifest.license.textVendored = true;
  process.stdout.write(`licence text ${licenseText.byteLength}B\n`);
} else {
  process.stdout.write(
    "licence text NOT vendored: creativecommons.org unreachable\n",
  );
}

manifest.totalBytes = total;
await writeFileEnsuringDir(
  join(ROOT, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

process.stdout.write(`\ntotal audio ${(total / 1024).toFixed(1)} KiB\n`);
