/**
 * The Tuning Intent Preservation Gate (spec 9.1, K-36).
 *
 * Candidate A asked for a drop-tuned low string, was given standard tuning by
 * a matcher that only knew the literal words "drop d", then wrote the D2 its
 * own plan called for and was refused for playing below its own low E. The
 * correction it spent was on a contradiction the plan never contained.
 *
 * These tests exist so an explicit tuning intent can never again become
 * standard tuning in silence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { resolveTuningIntent } from "@/lib/copilot/tuning-intent";
import { materializeSongSkeleton } from "@/lib/copilot/materialize";
import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import { requestFingerprint } from "@/lib/copilot/fingerprint";
import { validateRange } from "@/lib/validators/range";
import { fretboardRange, TUNING_PRESETS } from "@/lib/music/fretboard";
import { pitchToMidi } from "@/lib/music/pitch";
import { songSchema, type Song } from "@/lib/song/schema";
import { arrangeRequest } from "@/test/copilot-fixtures";

const onGuitar = (tuningIntent: string) =>
  resolveTuningIntent({ instrumentId: "electric_guitar", tuningIntent });

const DROP_D = TUNING_PRESETS.drop_d?.tuning ?? [];
const E_STANDARD = TUNING_PRESETS.e_standard?.tuning ?? [];

describe("tuning intent resolves against the registry", () => {
  it("uses the instrument's documented default when the plan says nothing", () => {
    const result = onGuitar("Bright and present, sits above the mix");
    expect(result.ok).toBe(true);
    if (!result.ok || result.status === "not_applicable") return;
    expect(result.status).toBe("defaulted");
    expect(result.tuning).toEqual(E_STANDARD);
  });

  it("reads a standard tuning intent as standard", () => {
    const result = onGuitar("Standard tuning, open strings left ringing");
    expect(result.ok).toBe(true);
    if (!result.ok || result.status === "not_applicable") return;
    expect(result.status).toBe("resolved");
    expect(result.tuning).toEqual(E_STANDARD);
  });

  it("reads Drop D as Drop D", () => {
    const result = onGuitar("Drop D for weight");
    expect(result.ok).toBe(true);
    if (!result.ok || result.status === "not_applicable") return;
    expect(result.tuningPresetId).toBe("drop_d");
  });

  it("reads the wording candidate A actually used", () => {
    const result = onGuitar("Drop-tuned low string for riff weight");
    expect(result.ok).toBe(true);
    if (!result.ok || result.status === "not_applicable") return;
    expect(result.status).toBe("resolved");
    expect(result.tuning).toEqual(DROP_D);
    expect(result.tuning[0]).toBe("D2");
  });

  it("does not care about case, hyphens or extra spacing", () => {
    const wordings = [
      "Drop-tuned low string",
      "drop tuned low string",
      "DROP   TUNED  low string",
      "Drop-D",
      "drop d",
      "lowest string tuned down to D",
    ];
    for (const wording of wordings) {
      const result = onGuitar(wording);
      expect(result.ok).toBe(true);
      if (!result.ok || result.status === "not_applicable") continue;
      expect(result.tuningPresetId).toBe("drop_d");
    }
  });

  it("does not care about punctuation around the words", () => {
    const result = onGuitar("Standard tuning, matched to the acoustic guitar");
    expect(result.ok).toBe(true);
    if (!result.ok || result.status === "not_applicable") return;
    expect(result.status).toBe("resolved");
  });

  it("fails closed on a tuning it does not support", () => {
    const result = onGuitar("Tuned down a whole step to D standard");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("unsupported");
  });

  it("fails closed when the tuning does not fit the instrument", () => {
    const result = resolveTuningIntent({
      instrumentId: "electric_guitar",
      tuningIntent: "Bass standard tuning",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("incompatible");
  });

  it("never turns an explicit intent into standard tuning in silence", () => {
    for (const wording of ["Drop-tuned low string", "Tuned down a whole step to D standard"]) {
      const result = onGuitar(wording);
      if (!result.ok) continue;
      if (result.status === "not_applicable") continue;
      expect(result.tuning).not.toEqual(E_STANDARD);
    }
  });

  it("reads standard on a bass as the bass's own standard, not the guitar's", () => {
    const result = resolveTuningIntent({
      instrumentId: "electric_bass",
      tuningIntent: "Standard tuning, aligned with the rhythm guitar",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.status === "not_applicable") return;
    expect(result.tuningPresetId).toBe("bass_standard");
    expect(result.tuning).toHaveLength(4);
  });

  it("invents no tuning for an instrument that has no strings", () => {
    const result = resolveTuningIntent({
      instrumentId: "drum_kit",
      tuningIntent: "Tight kick and tom tuning for articulation",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("not_applicable");
    expect(result).not.toHaveProperty("tuning");
  });
});

/** A blueprint with one guitar whose tuning intent is under test. */
function blueprintTuned(tuningIntent: string) {
  return compositionBlueprintSchema.parse({
    version: 1,
    targetDurationSeconds: 20,
    durationToleranceSeconds: 5,
    tonalCenter: "D minor",
    tuningIntent: "song level",
    resolution: 16,
    referenceTraits: ["heavy"],
    tracks: [
      {
        role: "rhythm_guitar",
        instrumentFamily: "guitar",
        presetIntent: "High-gain tight rhythm tone",
        tuningIntent,
        playsInSections: ["riff"],
        energyJob: "carries the riff",
        required: true,
        rationale: "the spine",
      },
    ],
    motifs: [
      {
        key: "cell",
        rhythmSignature: "two bar cell",
        accentStructure: "beat one",
        pitchContour: "root anchored",
        spaceCharacter: "rests carry",
        rationale: "the hook",
      },
    ],
    sections: [
      {
        key: "riff",
        displayName: "Riff",
        formRole: "break",
        bars: 1,
        timeSignature: [4, 4],
        bpm: 120,
        energy: "high",
        density: "high",
        tonalJob: "tonic pedal",
        motifKey: "cell",
        motifTransformation: "stated",
        entryIntent: "cold",
        exitIntent: "open",
        linkToPrevious: "",
        linkToNext: "",
        activeRoles: ["rhythm_guitar"],
        silentRoles: [],
      },
    ],
    requestedTechniques: [],
    omittedRequests: [],
  });
}

/** The materialized Song, with one note written into the only bar. */
function songWithNote(tuningIntent: string, pitch: string): Song | null {
  const built = materializeSongSkeleton(blueprintTuned(tuningIntent), { title: "tuning" });
  if (!built.ok) return null;
  const section = built.song.sections[0];
  const bar = section?.bars[0];
  if (!section || !bar) return null;
  const slots = [...(bar.slots.rhythm_guitar ?? [])];
  slots[0] = { notes: [{ pitch }] };
  return songSchema.parse({
    ...built.song,
    sections: [{ ...section, bars: [{ ...bar, slots: { rhythm_guitar: slots } }] }],
  });
}

describe("the resolved tuning reaches the same field range and fretboard read", () => {
  it("materialises Drop D from candidate A's own wording", () => {
    const built = materializeSongSkeleton(blueprintTuned("Drop-tuned low string for riff weight"));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.song.tracks[0]?.fretboard?.tuning).toEqual(DROP_D);
  });

  it("keeps capo at zero, whatever the tuning wording says", () => {
    for (const wording of ["Drop-tuned low string", "Standard tuning", "capo tuning talk"]) {
      const built = materializeSongSkeleton(blueprintTuned(wording));
      if (!built.ok) continue;
      expect(built.song.tracks[0]?.fretboard?.capo).toBe(0);
    }
  });

  it("lets the range validator accept D2 once the guitar is really in Drop D", () => {
    const song = songWithNote("Drop-tuned low string for riff weight", "D2");
    expect(song).not.toBeNull();
    if (!song) return;
    const issues = validateRange(song).filter((issue) => issue.code === "range");
    expect(issues).toEqual([]);
  });

  it("still refuses D2 on a guitar that really is in standard tuning", () => {
    const song = songWithNote("Standard tuning, open strings ringing", "D2");
    expect(song).not.toBeNull();
    if (!song) return;
    const issues = validateRange(song).filter((issue) => issue.code === "range");
    expect(issues).toHaveLength(1);
  });

  it("moves the low end of the fretboard range with the tuning", () => {
    const drop = fretboardRange({ tuning: DROP_D, capo: 0 });
    const standard = fretboardRange({ tuning: E_STANDARD, capo: 0 });
    if (drop === null || standard === null) throw new Error("tuning preset is unreadable");
    expect(drop.lowMidi).toBe(pitchToMidi("D2"));
    expect(standard.lowMidi).toBe(pitchToMidi("E2"));
    expect(drop.lowMidi).toBeLessThan(standard.lowMidi);
  });
});

describe("tuning intent is part of the question", () => {
  it("gives the same blueprint byte-identical materialization five times", () => {
    const runs = Array.from({ length: 5 }, () => {
      const built = materializeSongSkeleton(blueprintTuned("Drop-tuned low string"), {
        title: "fixed",
      });
      return built.ok ? JSON.stringify(built.song) : "failed";
    });
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).not.toBe("failed");
  });

  it("fingerprints two different tuning intents differently under one key", async () => {
    const drop = songWithNote("Drop-tuned low string", "E3");
    const standard = songWithNote("Standard tuning", "E3");
    if (drop === null || standard === null) throw new Error("fixture did not materialize");

    const request = (song: Song) =>
      arrangeRequest("rhythm_guitar", {
        song,
        targetTrackId: "rhythm_guitar",
        sectionId: song.sections[0]?.id ?? "sec-1",
        lockedTrackIds: [],
        idempotencyKey: "idem-key-0001",
      });

    const [a, b] = await Promise.all([
      requestFingerprint(request(drop)),
      requestFingerprint(request(standard)),
    ]);
    expect(a).not.toBe(b);
  });
});

describe("candidate A's stored blueprint, re-materialized", () => {
  const blueprint = compositionBlueprintSchema.parse(
    JSON.parse(
      readFileSync("eval/model-bakeoff-s03/artifacts/candidate-a/blueprint.json", "utf8"),
    ),
  );

  it("puts the riff and lead guitars in Drop D and leaves the acoustics standard", () => {
    const built = materializeSongSkeleton(blueprint, { title: "replay" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tuningOf = (id: string) =>
      built.song.tracks.find((track) => track.id === id)?.fretboard?.tuning;

    expect(tuningOf("rhythm_guitar")).toEqual(DROP_D);
    expect(tuningOf("lead_guitar")).toEqual(DROP_D);
    expect(tuningOf("acoustic_guitar")).toEqual(E_STANDARD);
    expect(tuningOf("harmony")).toEqual(E_STANDARD);
    expect(built.song.tracks.find((track) => track.id === "drums")?.fretboard).toBeUndefined();
  });
});
