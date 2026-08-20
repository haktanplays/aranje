/**
 * One composition blueprint, shared by the tests that need a plan.
 *
 * It was the fixture inside `blueprint.test.ts` until the grid plan needed
 * one too; two copies of a document this size drift, and a drifted fixture is
 * a test that passes for the wrong reason.
 */
import type { CompositionBlueprint } from "@/lib/copilot/blueprint";

export const PLAN = {
    version: 1,
    targetDurationSeconds: 60,
    durationToleranceSeconds: 5,
    tonalCenter: "D minor",
    tuningIntent: "drop D",
    resolution: 16,
    referenceTraits: ["syncopated stop-start groove", "half-time drum backbone"],
    tracks: [
      {
        role: "rhythm_guitar",
        instrumentFamily: "guitar",
        presetIntent: "amplified, high gain",
        tuningIntent: "drop D",
        playsInSections: ["a", "b"],
        energyJob: "Ritim gitar",
        required: true,
        rationale: "Ana riff bu track'te.",
      },
      {
        role: "drums",
        instrumentFamily: "drums",
        presetIntent: "rock kit",
        tuningIntent: "n/a",
        playsInSections: ["a"],
        energyJob: "Davul",
        required: true,
        rationale: "Groove'un omurgasi.",
      },
    ],
    motifs: [
      {
        key: "cell",
        rhythmSignature: "0 3 6 10 12 on a sixteenth grid",
        accentStructure: "accents on 0, 6 and 12; the rest choked",
        pitchContour: "1, with b3-2-1 as the answer",
        spaceCharacter: "more than half the bar is silence",
        rationale: "Duraklarla kesilen bir hucre.",
      },
    ],
    sections: [
      {
        key: "a",
        displayName: "Break",
        formRole: "break",
        bars: 4,
        timeSignature: [4, 4],
        bpm: 100,
        energy: "high",
        density: "medium",
        tonalJob: "tonic pedal",
        motifKey: "cell",
        motifTransformation: "stated plainly",
        entryIntent: "straight in",
        exitIntent: "hand over on a held tonic",
        linkToPrevious: "",
        linkToNext: "same rhythmic cell",
        activeRoles: ["rhythm_guitar", "drums"],
        silentRoles: [],
      },
      {
        key: "b",
        displayName: "Outro",
        formRole: "outro",
        bars: 4,
        timeSignature: [4, 4],
        bpm: 80,
        energy: "low",
        density: "low",
        tonalJob: "resolves to the tonic",
        motifKey: "cell",
        motifTransformation: "a quiet shadow of it",
        entryIntent: "takes over the held tonic",
        exitIntent: "left ringing",
        linkToPrevious: "common tone",
        linkToNext: "",
        activeRoles: ["rhythm_guitar"],
        silentRoles: ["drums"],
      },
    ],
    requestedTechniques: [
      { technique: "palm_mute", sectionKey: "a", purpose: "Pedal notayi boguyor." },
    ],
    omittedRequests: [
      { request: "bass", reason: "Dusuk tel yuku ritim gitarda; bas gerekmedi." },
    ],
} as const satisfies Record<string, unknown> as unknown as CompositionBlueprint;
