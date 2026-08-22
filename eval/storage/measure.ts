/**
 * What the envelope costs, measured rather than estimated (spec 13.14).
 *
 * The worst case is not a guess: it is the largest song the *current* limits
 * allow — eight tracks, thirty-two bars, and every bar written at the finest
 * grid with something in every slot. A number derived from anything else
 * would be a product opinion about how big songs get, which is not this
 * checkpoint's to have.
 *
 * `npx tsx eval/storage/measure.ts`
 */
import { writeFileSync } from "node:fs";

import { sizes, worstCaseSong } from "../shared/worst-case-song";

import {
  nextEnvelope,
  decideLoad,
  type SongStorageEnvelopeV1,
} from "@/lib/song/storage-envelope";
import { songSchema } from "@/lib/song/schema";

const song = songSchema.parse(worstCaseSong());

const raw = sizes(song);
const firstWrite: SongStorageEnvelopeV1 = nextEnvelope(song, { kind: "empty" });
const currentOnly = sizes(firstWrite);
const fullEnvelope = nextEnvelope(song, decideLoad(JSON.stringify(firstWrite)));
const both = sizes(fullEnvelope);

const report = {
  limits: {
    tracks: song.tracks.length,
    bars: song.sections.reduce((sum, section) => sum + section.bars.length, 0),
    resolution: 32,
  },
  rawSong: raw,
  envelopeCurrentOnly: currentOnly,
  envelopeCurrentAndPrevious: both,
  growthOverLegacy: {
    currentOnly: Number((currentOnly.utf8Bytes / raw.utf8Bytes).toFixed(3)),
    withPrevious: Number((both.utf8Bytes / raw.utf8Bytes).toFixed(3)),
  },
  /*
   * Not a limit anyone invented: the ceiling this checkpoint has to live
   * inside is the worst case doubled, because that is what the format itself
   * costs. Whether a given browser has that much is a runtime question, and
   * the only honest answer to it is a real `setItem` that either works or
   * throws — which is why the write path fails closed rather than predicting.
   * `quota-check.mjs` performs that real attempt in production Chromium; it
   * is not an iOS Safari acceptance, which stays open.
   */
  worstCaseFile: both,
  worstCaseFileMiB: Number((both.utf8Bytes / (1024 * 1024)).toFixed(3)),
};

writeFileSync(
  "eval/storage/BYTES.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

/*
 * The payload, on request, for the real-browser write attempt. Behind an env
 * flag so the checked-in artifact stays a report, not a 1.5 MiB fixture.
 */
const payloadOut = process.env.WORST_OUT;
if (payloadOut) {
  writeFileSync(payloadOut, JSON.stringify(fullEnvelope), "utf8");
}

console.log(JSON.stringify(report, null, 2));
