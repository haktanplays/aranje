/**
 * Close the S-03 run with artefacts that cannot be argued with later.
 *
 * The run is a `transport_and_materializer_confounded_shadow_run`. That is not
 * a hedge: two confounds at opposite ends of the pipeline reach far enough into
 * the result that several listening criteria are contaminated rather than
 * merely noisy. The point of this file is to write down exactly which ones, and
 * exactly what was lost where, while the evidence is still on disk.
 *
 * It reads artefacts and writes a summary. It never edits a model's answer, a
 * blueprint, or a materialized Song.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import { CONFOUNDS, RUN_CLASSIFICATION } from "./failure-class.js";

const ROOT = "eval/model-bakeoff-s03/artifacts";
const read = (candidate: string, name: string) =>
  readFileSync(`${ROOT}/${candidate}/${name}`, "utf8");
const has = (candidate: string, name: string) => existsSync(`${ROOT}/${candidate}/${name}`);

/** What a listener could fairly judge from this run, and what they could not. */
const LISTENING_CRITERIA = [
  { criterion: "Rhythmic vocabulary: grid choice and whether high resolution was earned", verdict: "assessable" },
  { criterion: "Motif development across Break, Bridge and Solo", verdict: "assessable" },
  { criterion: "Use of space; whether rests carry weight", verdict: "assessable" },
  { criterion: "Section-to-section handover and tempo easing", verdict: "assessable" },
  { criterion: "Phrase breathing in the solo", verdict: "assessable" },
  {
    criterion: "The acoustic-only brief",
    verdict: "contaminated",
    why: "harmony materialises as electric_guitar, so the close contains an electric guitar the plan never asked for.",
  },
  {
    criterion: "Harmony fit against the acoustic guitar",
    verdict: "contaminated",
    why: "the harmony turn was shown a rhythm guitar that is silent in that section, not the acoustic track it accompanies.",
  },
  {
    criterion: "Timbre and preset choice",
    verdict: "contaminated",
    why: "presetIntent and tuningIntent never reach the materializer; every instrument came from a fixed role table.",
  },
  {
    criterion: "Overall final quality, and any A/B comparison",
    verdict: "contaminated",
    why: "candidate B never produced an accepted blueprint under a transport stricter than production, so there is no second song to compare.",
  },
] as const;

/** Blueprint intent beside what materialization actually produced. */
function intentDiff(candidate: string) {
  if (!has(candidate, "blueprint.json") || !has(candidate, "skeleton.json")) return null;
  const blueprint = compositionBlueprintSchema.parse(JSON.parse(read(candidate, "blueprint.json")));
  const song = JSON.parse(read(candidate, "skeleton.json")) as {
    tracks: { id: string; instrumentId: string }[];
  };
  const byId = new Map(song.tracks.map((track) => [track.id, track.instrumentId]));

  const tracks = blueprint.tracks.map((track) => ({
    role: track.role,
    blueprintInstrumentFamily: track.instrumentFamily,
    blueprintPresetIntent: track.presetIntent,
    blueprintTuningIntent: track.tuningIntent,
    materializedInstrumentId: byId.get(track.role) ?? null,
    presetIntentPreserved: false,
    tuningIntentPreserved: false,
    familyHonoured:
      (byId.get(track.role) ?? "").includes("acoustic")
        ? track.instrumentFamily === "guitar"
        : true,
  }));

  return {
    songTuningIntent: blueprint.tuningIntent,
    /* Nothing in Song carries either field, so both are lost for every track. */
    lostFields: ["instrumentFamily", "presetIntent", "tuningIntent"],
    tracks,
    acousticOnlySections: blueprint.sections
      .filter((section) => section.activeRoles.every((role) => role === "acoustic_guitar" || role === "harmony"))
      .map((section) => ({
        key: section.key,
        activeRoles: [...section.activeRoles],
        materializedInstruments: section.activeRoles.map((role) => ({
          role,
          instrumentId: byId.get(role) ?? null,
        })),
        violated: section.activeRoles.some((role) => (byId.get(role) ?? "").startsWith("electric")),
      })),
  };
}

/** Every attempt, with what was normalised and what the chain said. */
function attemptRecord(candidate: string) {
  if (!has(candidate, "attempts.json")) return null;
  const { attempts } = JSON.parse(read(candidate, "attempts.json")) as {
    attempts: {
      stage: string;
      attempt: number;
      outcome: string;
      failure: string | null;
      reason: string | null;
      normalizationApplied: string | null;
      rawSha256: string;
      normalizedSha256: string;
    }[];
  };

  const corrections = new Map<string, number>();
  for (const record of attempts) {
    if (record.outcome !== "rejected" || record.failure === "packaging_only") continue;
    corrections.set(record.stage, (corrections.get(record.stage) ?? 0) + 1);
  }

  return attempts.map((record) => ({
    ...record,
    fenceUnwrapped: record.normalizationApplied !== null,
    bodyUnchanged: record.normalizationApplied === null
      ? record.rawSha256 === record.normalizedSha256
      : record.rawSha256 !== record.normalizedSha256,
    correctionsSpentOnStage: corrections.get(record.stage) ?? 0,
  }));
}

const closing = {
  runClassification: RUN_CLASSIFICATION,
  confounds: CONFOUNDS,
  statement:
    "This run is a harness and production-boundary finding, not a measurement of either model's musical quality. " +
    "No winner is declared. Candidate A is not the winner; candidate B is not a musical loser. No blind A/B package exists, " +
    "because only one candidate produced a song.",
  candidates: {
    a: { attempts: attemptRecord("candidate-a"), intentDiff: intentDiff("candidate-a") },
    b: { attempts: attemptRecord("candidate-b"), intentDiff: intentDiff("candidate-b") },
  },
  listeningCriteria: LISTENING_CRITERIA,
  lostSourceContexts: [
    {
      turn: "Solo / rhythm_guitar",
      askedFor: "backing that stays out of the lead's way",
      shown: "drums only, and the Solo drums were not written until the next turn",
      soSaw: "nothing",
    },
    {
      turn: "Acoustic Bridge / harmony",
      askedFor: "a second line that does not cover the main guitar",
      shown: "guitars.slice(0, 1), which is the rhythm guitar",
      soSaw: "a track that is silent in that section",
    },
  ],
};

writeFileSync(
  "eval/model-bakeoff-s03/artifacts/CLOSING.json",
  `${JSON.stringify(closing, null, 2)}\n`,
);
console.log(`classification: ${closing.runClassification}`);
console.log(`confounds: ${closing.confounds.length}`);
for (const entry of LISTENING_CRITERIA) {
  console.log(`  ${entry.verdict.padEnd(13)} ${entry.criterion}`);
}
