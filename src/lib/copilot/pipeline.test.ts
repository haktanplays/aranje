import { describe, expect, it } from "vitest";

import { createFakeAdapter, type FakeScenario } from "@/lib/ai/fake-adapter";
import { arrangeAnswer, arrangeBars } from "@/lib/ai/fake-skills";
import { createFakeClock, type FakeClock } from "@/lib/budget/clock";
import { requestCostMicros, worstCaseReservationMicros } from "@/lib/budget/cost";
import { createMemoryKv, type MemoryKv } from "@/lib/budget/memory-kv";
import { readSpend } from "@/lib/budget/reservation";
import type { CopilotConfig } from "@/lib/config/copilot";
import type { ArrangeSkill, CopilotSuccessBody } from "@/lib/copilot/contract";
import { runCopilot, type PipelineDeps } from "@/lib/copilot/pipeline";
import { applyPatch } from "@/lib/copilot/apply";
import { checkLockedSurface, surfaceDigest } from "@/lib/copilot/scope";
import { createMemoryMeter } from "@/lib/metering/events";
import type { Section, Song, Track } from "@/lib/song/schema";
import type { Validator } from "@/lib/validators/types";
import {
  FIXED_NOW,
  HARMONY_SONG,
  PLACEHOLDER_PRICE_TABLE,
  TEST_SONG,
  arrangeRequest,
  mainSection,
  testConfig,
  usage,
} from "@/test/copilot-fixtures";

const PRICE = PLACEHOLDER_PRICE_TABLE.models["claude-sonnet-5"];
if (!PRICE) throw new Error("fixture price missing");

const WORST_CASE = worstCaseReservationMicros(
  { maxInputTokens: 8000, maxOutputTokens: 4000 },
  PRICE,
);

const LIMITS = {
  dailyBudgetUsd: 2,
  monthlyBudgetUsd: 20,
  freePatchesPerUserPerDay: 3,
};

const SECTION_ID = mainSection().id;
const TARGETS: Readonly<Record<ArrangeSkill, string>> = {
  drums: "drums",
  bass: "bass",
  harmony: "gtr2",
};

function songFor(skill: ArrangeSkill): Song {
  return skill === "harmony" ? HARMONY_SONG : TEST_SONG;
}

function sectionOf(song: Song): Section {
  const section = song.sections.find((entry) => entry.id === SECTION_ID);
  if (!section) throw new Error("fixture section missing");
  return section;
}

function trackOf(song: Song, id: string): Track {
  const track = song.tracks.find((entry) => entry.id === id);
  if (!track) throw new Error(`fixture has no track ${id}`);
  return track;
}

/** What a well-behaved provider would answer for this skill. */
function goodAnswer(skill: ArrangeSkill): string {
  const song = songFor(skill);
  return arrangeAnswer({
    song,
    section: sectionOf(song),
    target: trackOf(song, TARGETS[skill]),
    skill,
    sectionId: SECTION_ID,
  });
}

function goodRound(skill: ArrangeSkill): FakeScenario {
  return { kind: "success", raw: goodAnswer(skill), usage: usage() };
}

type Harness = {
  deps: PipelineDeps;
  kv: MemoryKv;
  clock: FakeClock;
  adapter: ReturnType<typeof createFakeAdapter>;
  meter: ReturnType<typeof createMemoryMeter>;
};

function harness(
  scenarios: readonly FakeScenario[],
  overrides: Partial<CopilotConfig> = {},
  extra: Partial<PipelineDeps> = {},
): Harness {
  const clock = createFakeClock(FIXED_NOW);
  const kv = createMemoryKv(clock);
  const adapter = createFakeAdapter(scenarios);
  const meter = createMemoryMeter();

  let requestCounter = 0;
  let patchCounter = 0;

  const deps: PipelineDeps = {
    config: testConfig(overrides),
    kv,
    clock,
    adapter,
    meter,
    newRequestId: () => `req-${(requestCounter += 1)}`,
    newPatchId: () => `patch-${(patchCounter += 1)}`,
    ...extra,
  };

  return { deps, kv, clock, adapter, meter };
}

const SKILLS: ArrangeSkill[] = ["drums", "bass", "harmony"];

// ---------------------------------------------------------------------------
// 1-6. each skill changes its own track and nothing else
// ---------------------------------------------------------------------------
describe("each skill changes only its own track", () => {
  for (const skill of SKILLS) {
    it(`${skill}: returns a patch aimed at the target track`, async () => {
      const { deps, adapter } = harness([goodRound(skill)]);
      const outcome = await runCopilot(deps, arrangeRequest(skill));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.body.patch.operation).toBe("arrange_track");
      expect(outcome.body.patch.targetTrackId).toBe(TARGETS[skill]);
      expect(outcome.body.patch.sectionId).toBe(SECTION_ID);
      expect(outcome.body.patch.id).toBe("patch-1");
      expect(adapter.calls).toHaveLength(1);
    });

    it(`${skill}: leaves every locked surface exactly where it was`, async () => {
      const { deps } = harness([goodRound(skill)]);
      const song = songFor(skill);
      const outcome = await runCopilot(deps, arrangeRequest(skill));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const applied = applyPatch(song, outcome.body.patch);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;

      expect(
        checkLockedSurface(surfaceDigest(song), surfaceDigest(applied.song), {
          sectionId: SECTION_ID,
          targetTrackId: TARGETS[skill],
        }),
      ).toEqual([]);

      // The source guitar in particular is byte-identical.
      const before = sectionOf(song).bars.map((bar) => bar.slots.gtr);
      const after = applied.song.sections
        .find((entry) => entry.id === SECTION_ID)
        ?.bars.map((bar) => bar.slots.gtr);
      expect(after).toEqual(before);

      // Song and section metadata, and the global track list, are untouched.
      expect(applied.song.title).toBe(song.title);
      expect(applied.song.bpm).toBe(song.bpm);
      expect(applied.song.key).toBe(song.key);
      expect(applied.song.tracks).toEqual(song.tracks);
      expect(applied.song.sections.map((s) => s.id)).toEqual(
        song.sections.map((s) => s.id),
      );
    });

    it(`${skill}: passes the whole validator chain as a candidate`, async () => {
      const seen: Song[] = [];
      const spy: Validator = (candidate) => {
        seen.push(candidate);
        return [];
      };
      const { deps } = harness([goodRound(skill)], {}, { songValidators: [spy] });
      const outcome = await runCopilot(deps, arrangeRequest(skill));

      expect(outcome.ok).toBe(true);
      // Judged as a whole song, not as a fragment.
      expect(seen).toHaveLength(1);
      expect(seen[0]?.key).toBe(songFor(skill).key);
      expect(seen[0]?.sections).toHaveLength(songFor(skill).sections.length);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. a mis-aimed request never reaches the provider
// ---------------------------------------------------------------------------
describe("a mis-aimed request is refused before the provider", () => {
  const cases: { name: string; request: ReturnType<typeof arrangeRequest> }[] = [
    { name: "drums at a guitar", request: arrangeRequest("drums", { targetTrackId: "gtr" }) },
    { name: "bass at a guitar", request: arrangeRequest("bass", { targetTrackId: "gtr" }) },
    { name: "harmony at a bass", request: arrangeRequest("harmony", { targetTrackId: "bass" }) },
    { name: "harmony at a drum kit", request: arrangeRequest("harmony", { targetTrackId: "drums" }) },
    { name: "a track that is not in the song", request: arrangeRequest("drums", { targetTrackId: "ghost" }) },
    { name: "a section that is not in the song", request: arrangeRequest("drums", { sectionId: "nowhere" }) },
    { name: "a target the caller locked", request: arrangeRequest("drums", { lockedTrackIds: ["drums"] }) },
  ];

  for (const entry of cases) {
    it(`refuses ${entry.name}, with no provider call`, async () => {
      const { deps, adapter } = harness([goodRound("drums")]);
      const outcome = await runCopilot(deps, entry.request);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.body.code).toBe("invalid_request");
      expect(adapter.calls).toHaveLength(0);
    });
  }

  it("costs nothing when the request is refused", async () => {
    const { deps } = harness([goodRound("drums")]);
    await runCopilot(deps, arrangeRequest("drums", { targetTrackId: "gtr" }));
    expect(
      await readSpend({ kv: deps.kv, clock: deps.clock, limits: LIMITS }),
    ).toEqual({ dayMicros: 0, monthMicros: 0 });
  });
});

// ---------------------------------------------------------------------------
// 8-10. an answer that misses the surface is refused
// ---------------------------------------------------------------------------
describe("an answer must describe the surface it was asked about", () => {
  function badAnswer(overrides: Record<string, unknown>): string {
    const song = TEST_SONG;
    return JSON.stringify({
      operation: "arrange_track",
      sectionId: SECTION_ID,
      targetTrackId: "drums",
      bars: arrangeBars({
        song,
        section: sectionOf(song),
        target: trackOf(song, "drums"),
        skill: "drums",
      }),
      explanation: "x",
      ...overrides,
    });
  }

  const rejected: { name: string; raw: string; code: string }[] = [
    {
      name: "aimed at another section",
      raw: badAnswer({ sectionId: "main-riff" }),
      code: "provider_output_invalid",
    },
    {
      name: "aimed at another track",
      raw: badAnswer({ targetTrackId: "gtr" }),
      code: "provider_output_invalid",
    },
    {
      name: "carrying a section object",
      raw: badAnswer({ section: { id: "x", name: "y", status: "pending", bars: [] } }),
      code: "provider_output_invalid",
    },
    {
      name: "carrying track metadata",
      raw: badAnswer({ tracks: [{ id: "drums", name: "Hacked" }] }),
      code: "provider_output_invalid",
    },
    {
      name: "with too few bars",
      raw: badAnswer({ bars: [{ barIndex: 0, slots: Array.from({ length: 8 }, () => []) }] }),
      code: "patch_out_of_scope",
    },
    {
      name: "with a repeated bar",
      raw: badAnswer({
        bars: Array.from({ length: 4 }, () => ({
          barIndex: 0,
          slots: Array.from({ length: 8 }, () => []),
        })),
      }),
      code: "patch_out_of_scope",
    },
    {
      name: "with the wrong slot count",
      raw: badAnswer({
        bars: Array.from({ length: 4 }, (_, barIndex) => ({
          barIndex,
          slots: Array.from({ length: 7 }, () => []),
        })),
      }),
      code: "patch_out_of_scope",
    },
    {
      name: "with melodic slots on a drum track",
      raw: badAnswer({
        bars: Array.from({ length: 4 }, (_, barIndex) => ({
          barIndex,
          slots: Array.from({ length: 8 }, () => null),
        })),
      }),
      code: "patch_out_of_scope",
    },
    {
      name: "with an unknown field",
      raw: badAnswer({ confidence: 0.9 }),
      code: "provider_output_invalid",
    },
    {
      name: "with a patch id of its own",
      raw: badAnswer({ id: "model-chose-this" }),
      code: "provider_output_invalid",
    },
  ];

  for (const entry of rejected) {
    it(`refuses an answer ${entry.name}`, async () => {
      const scenario: FakeScenario = { kind: "invalid_output", raw: entry.raw };
      const { deps } = harness([scenario, scenario, scenario]);
      const outcome = await runCopilot(deps, arrangeRequest("drums"));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.body.code).toBe(entry.code);
    });
  }

  it("refuses a written string and fret in a melodic answer", async () => {
    const song = HARMONY_SONG;
    const raw = JSON.stringify({
      operation: "arrange_track",
      sectionId: SECTION_ID,
      targetTrackId: "gtr2",
      bars: sectionOf(song).bars.map((_, barIndex) => ({
        barIndex,
        slots: [
          { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] },
          ...Array.from({ length: 7 }, () => null),
        ],
      })),
      explanation: "x",
    });
    const scenario: FakeScenario = { kind: "invalid_output", raw };
    const { deps } = harness([scenario, scenario, scenario]);

    const outcome = await runCopilot(deps, arrangeRequest("harmony"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("provider_output_invalid");
  });

  it("lets the deterministic engine place a melodic answer instead", async () => {
    const { deps } = harness([goodRound("harmony")]);
    const outcome = await runCopilot(deps, arrangeRequest("harmony"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const notes = outcome.body.patch.bars.flatMap((bar) =>
      bar.slots.flatMap((slot) =>
        slot !== null && slot !== "-" && !Array.isArray(slot) ? slot.notes : [],
      ),
    );
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note).not.toHaveProperty("position");
  });

  it("recovers when a correction round answers properly", async () => {
    const { deps, adapter } = harness([
      { kind: "invalid_output", raw: "not json" },
      goodRound("drums"),
    ]);
    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(true);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1]?.userMessage).toContain("dogrulama hatalari");
  });
});

// ---------------------------------------------------------------------------
// locked surface, at the apply layer
// ---------------------------------------------------------------------------
describe("the locked surface guard is a second lock, not the only one", () => {
  it("refuses an apply that touches anything outside the target track", async () => {
    // The narrow output schema cannot say "and change the guitar too", and the
    // real apply writes to one surface by construction. So the guard is
    // exercised against an apply that deliberately misbehaves: this is the
    // check that neither of the first two locks was the only thing standing
    // between a bad answer and the song.
    const sabotage = (song: Song): { ok: true; song: Song } => ({
      ok: true,
      song: {
        ...song,
        sections: song.sections.map((section) =>
          section.id === SECTION_ID
            ? {
                ...section,
                name: "Hacked",
                bars: section.bars.map((bar) => ({
                  ...bar,
                  slots: {
                    ...bar.slots,
                    gtr: Array.from({ length: 8 }, () => null),
                  },
                })),
              }
            : section,
        ),
      },
    });

    const { deps, adapter } = harness([goodRound("drums")], {}, {
      applyPatch: sabotage,
      songValidators: [
        () => {
          throw new Error("song validators must not run after a scope violation");
        },
      ],
    });

    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("locked_surface_violation");
    // Not a correction round: this is not something to ask the model to retry.
    expect(adapter.calls).toHaveLength(1);
  });

  it("refuses an apply that writes into another section", async () => {
    const other = TEST_SONG.sections.find((entry) => entry.id !== SECTION_ID);
    if (!other) throw new Error("fixture needs two sections");

    const sabotage = (song: Song): { ok: true; song: Song } => ({
      ok: true,
      song: {
        ...song,
        sections: song.sections.map((section) =>
          section.id === other.id
            ? {
                ...section,
                bars: section.bars.map((bar) => ({
                  ...bar,
                  slots: {
                    ...bar.slots,
                    drums: Array.from({ length: 8 }, () => []),
                  },
                })),
              }
            : section,
        ),
      },
    });

    const { deps } = harness([goodRound("drums")], {}, { applyPatch: sabotage });
    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("locked_surface_violation");
  });

  it("refuses an apply that changes global track metadata", async () => {
    const sabotage = (song: Song): { ok: true; song: Song } => ({
      ok: true,
      song: {
        ...song,
        tracks: song.tracks.map((track) =>
          track.id === "gtr" && track.fretboard
            ? { ...track, fretboard: { ...track.fretboard, capo: 4 } }
            : track,
        ),
      },
    });

    const { deps } = harness([goodRound("drums")], {}, { applyPatch: sabotage });
    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("locked_surface_violation");
  });

  it("lets an honest apply through", async () => {
    const { deps } = harness([goodRound("drums")]);
    expect((await runCopilot(deps, arrangeRequest("drums"))).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12-14. tonal majority and the warnings
// ---------------------------------------------------------------------------
describe("the candidate is judged by the new tonal core", () => {
  /** One note, or a stack of them when a bar needs weight in the count. */
  function chordAt(pitches: readonly string[], index: number) {
    const pitch = pitches[index];
    if (pitch === undefined) return [];
    return [{ pitch }];
  }

  function melodicAnswer(pitches: readonly string[]): string {
    const song = HARMONY_SONG;
    return JSON.stringify({
      operation: "arrange_track",
      sectionId: SECTION_ID,
      targetTrackId: "gtr2",
      bars: sectionOf(song).bars.map((_, barIndex) => ({
        barIndex,
        slots: Array.from({ length: 8 }, (_, slotIndex) =>
          slotIndex < pitches.length
            ? { notes: chordAt(pitches, slotIndex) }
            : null,
        ),
      })),
      explanation: "x",
    });
  }

  /** Every slot of every bar filled with a colour chord: no core majority. */
  function colourFloodAnswer(): string {
    const song = HARMONY_SONG;
    return JSON.stringify({
      operation: "arrange_track",
      sectionId: SECTION_ID,
      targetTrackId: "gtr2",
      bars: sectionOf(song).bars.map((_, barIndex) => ({
        barIndex,
        slots: Array.from({ length: 8 }, () => ({
          // F, G# and Bb are all colour tones in E minor.
          notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }],
        })),
      })),
      explanation: "x",
    });
  }

  it("lets a single colour note through when the core has the majority", async () => {
    // E minor: E, G, B are core; D# is the raised seventh, a colour tone.
    const raw = melodicAnswer(["E3", "G3", "B3", "D#4"]);
    const { deps } = harness([{ kind: "success", raw, usage: usage() }]);
    const outcome = await runCopilot(deps, arrangeRequest("harmony"));
    expect(outcome.ok).toBe(true);
  });

  it("refuses a bar that is mostly colour", async () => {
    // F, G#, Bb and C# are all colour in E minor. Enough of them outweigh the
    // guitar's own core notes, which are counted in the same bar.
    const raw = colourFloodAnswer();
    const scenario: FakeScenario = { kind: "invalid_output", raw };
    const { deps } = harness([scenario, scenario, scenario]);

    const outcome = await runCopilot(deps, arrangeRequest("harmony"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("patch_invalid");
  });

  it("returns spec 10.3 warnings without blocking the patch", async () => {
    // E2 and F2 both live only on the thickest string: unplaceable together.
    const raw = JSON.stringify({
      operation: "arrange_track",
      sectionId: SECTION_ID,
      targetTrackId: "gtr2",
      bars: sectionOf(HARMONY_SONG).bars.map((_, barIndex) => ({
        barIndex,
        slots:
          barIndex === 0
            ? [
                { notes: [{ pitch: "E2" }, { pitch: "F2" }] },
                { notes: [{ pitch: "G2" }] },
                { notes: [{ pitch: "B2" }] },
                ...Array.from({ length: 5 }, () => null),
              ]
            : Array.from({ length: 8 }, () => null),
      })),
      explanation: "x",
    });
    const { deps } = harness([{ kind: "success", raw, usage: usage() }]);

    const outcome = await runCopilot(deps, arrangeRequest("harmony"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.body.warnings.map((issue) => issue.code)).toContain(
      "unplaceable",
    );
    expect(outcome.body.warnings.every((issue) => issue.severity === "warning")).toBe(
      true,
    );
  });

  it("returns the same warnings in the same order for the same input", async () => {
    const a = harness([goodRound("harmony")]);
    const b = harness([goodRound("harmony")]);
    const first = await runCopilot(a.deps, arrangeRequest("harmony"));
    const second = await runCopilot(b.deps, arrangeRequest("harmony"));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.body.warnings).toEqual(second.body.warnings);
  });
});

// ---------------------------------------------------------------------------
// 15-16. ceilings and prompt size
// ---------------------------------------------------------------------------
describe("token ceilings (spec 11.3)", () => {
  it("refuses an oversized input before the adapter is called", async () => {
    const { deps, adapter } = harness([goodRound("drums")], { maxInputTokens: 10 });
    const outcome = await runCopilot(deps, arrangeRequest("drums"));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("input_too_large");
    expect(adapter.calls).toHaveLength(0);
  });

  it("puts the output ceiling on the request, not in the prompt", async () => {
    const { deps, adapter } = harness([goodRound("drums")]);
    await runCopilot(deps, arrangeRequest("drums"));
    expect(adapter.calls[0]?.maxOutputTokens).toBe(4000);
    const prompt = `${adapter.calls[0]?.system.join(" ")} ${adapter.calls[0]?.userMessage}`;
    expect(prompt).not.toContain("4000");
  });

  it("sends a prompt well inside the configured ceiling", async () => {
    const { deps, adapter } = harness([goodRound("bass")]);
    await runCopilot(deps, arrangeRequest("bass"));
    const estimated = adapter.calls[0]?.estimatedInputTokens ?? 0;
    expect(estimated).toBeGreaterThan(0);
    expect(estimated).toBeLessThan(8000);
  });

  it("fails closed while the worst-case invariant is broken", async () => {
    const { deps, adapter } = harness([goodRound("drums")], { maxOutputTokens: 40_000 });
    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("budget_invariant_violated");
    expect(adapter.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 17-19. the phase 2A guardrails still hold
// ---------------------------------------------------------------------------
describe("the phase 2A budget and idempotency rules are untouched", () => {
  it("reserves the worst case, then reconciles down to what was used", async () => {
    const { deps, meter } = harness([goodRound("drums")]);
    await runCopilot(deps, arrangeRequest("drums"));

    const spend = await readSpend({ kv: deps.kv, clock: deps.clock, limits: LIMITS });
    const actual = requestCostMicros(usage(), PRICE);
    expect(spend.dayMicros).toBe(actual);
    expect(meter.events[0]?.reservedMicros).toBe(WORST_CASE);
    expect(meter.events[0]?.refundedMicros).toBe(WORST_CASE - actual);
  });

  it("spends the whole reservation when usage cannot be verified", async () => {
    const { deps, meter } = harness([
      { kind: "success_unverified_usage", raw: goodAnswer("drums"), reason: "none" },
    ]);
    expect((await runCopilot(deps, arrangeRequest("drums"))).ok).toBe(true);
    expect(
      (await readSpend({ kv: deps.kv, clock: deps.clock, limits: LIMITS })).dayMicros,
    ).toBe(WORST_CASE);
    expect(meter.events[0]?.refundedMicros).toBe(0);
  });

  for (const entry of [
    { name: "timeout", scenario: { kind: "timeout" } as FakeScenario, code: "provider_timeout" },
    { name: "network error", scenario: { kind: "network_error" } as FakeScenario, code: "provider_error" },
    { name: "abort", scenario: { kind: "aborted" } as FakeScenario, code: "request_aborted" },
  ]) {
    it(`keeps the reservation after a ${entry.name}`, async () => {
      const { deps } = harness([entry.scenario]);
      const outcome = await runCopilot(deps, arrangeRequest("drums"));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.body.code).toBe(entry.code);
      expect(
        (await readSpend({ kv: deps.kv, clock: deps.clock, limits: LIMITS })).dayMicros,
      ).toBe(WORST_CASE);
    });
  }

  it("answers a repeat from the record, with one provider call and no new cost", async () => {
    const { deps, adapter } = harness([goodRound("drums")]);
    const request = arrangeRequest("drums");

    const first = await runCopilot(deps, request);
    const spendAfterFirst = await readSpend({
      kv: deps.kv,
      clock: deps.clock,
      limits: LIMITS,
    });
    const second = await runCopilot(deps, request);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.body.cached).toBe(true);
    expect(second.body.patch).toEqual(first.body.patch);
    expect(adapter.calls).toHaveLength(1);
    expect(
      await readSpend({ kv: deps.kv, clock: deps.clock, limits: LIMITS }),
    ).toEqual(spendAfterFirst);
  });

  it("does not overspend when two callers arrive together", async () => {
    const { deps, adapter } = harness([goodRound("drums"), goodRound("bass")], {
      dailyBudgetUsd: WORST_CASE / 1_000_000,
    });

    const [a, b] = await Promise.all([
      runCopilot(deps, arrangeRequest("drums", { subjectId: "device-a" })),
      runCopilot(
        deps,
        arrangeRequest("bass", {
          subjectId: "device-b",
          idempotencyKey: "idem-key-0002",
        }),
      ),
    ]);

    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const refused = a.ok ? b : a;
    if (refused.ok) return;
    expect(refused.body.code).toBe("budget_exhausted");
    expect(adapter.calls).toHaveLength(1);
  });

  it("refuses a subject that has used its free patches", async () => {
    const { deps } = harness([
      goodRound("drums"),
      goodRound("drums"),
      goodRound("drums"),
      goodRound("drums"),
    ]);

    for (let index = 0; index < 3; index += 1) {
      const outcome = await runCopilot(
        deps,
        arrangeRequest("drums", { idempotencyKey: `idem-key-000${index}` }),
      );
      expect(outcome.ok).toBe(true);
    }
    const overQuota = await runCopilot(
      deps,
      arrangeRequest("drums", { idempotencyKey: "idem-key-0009" }),
    );
    expect(overQuota.ok).toBe(false);
    if (overQuota.ok) return;
    expect(overQuota.body.code).toBe("quota_exhausted");
  });

  it("refuses everything while the counter store is unreachable", async () => {
    const { deps, kv, adapter } = harness([goodRound("drums")]);
    kv.setAvailable(false);
    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("kv_unavailable");
    expect(adapter.calls).toHaveLength(0);
  });

  it("routes musical work to the default model, never the cheap one", async () => {
    const { deps, meter } = harness([goodRound("drums")], {
      enableCheapRouting: true,
      cheapModelVerifiedAt: "2026-08-19T00:00:00Z",
    });
    await runCopilot(deps, arrangeRequest("drums"));
    expect(meter.events[0]?.adapterRoute).toBe("default");
    expect(meter.events[0]?.model).toBe("claude-sonnet-5");
  });

  it("never puts the provider's own words in the answer", async () => {
    const { deps } = harness([
      { kind: "network_error", diagnostic: "ECONNRESET key=sk-live-xyz" },
    ]);
    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const serialised = JSON.stringify(outcome.body);
    expect(serialised).not.toContain("ECONNRESET");
    expect(serialised).not.toContain("sk-live");
  });
});

// ---------------------------------------------------------------------------
// 18. the fingerprint tells the skills and targets apart
// ---------------------------------------------------------------------------
describe("idempotency separates one question from another", () => {
  const cases: { name: string; overrides: Parameters<typeof arrangeRequest>[1] }[] = [
    { name: "a different instruction", overrides: { instruction: "Bambaska" } },
    { name: "a different locked surface", overrides: { lockedTrackIds: [] } },
  ];

  for (const entry of cases) {
    it(`reports a conflict for ${entry.name} under the same key`, async () => {
      const { deps, adapter } = harness([goodRound("drums")]);
      await runCopilot(deps, arrangeRequest("drums"));

      const outcome = await runCopilot(deps, arrangeRequest("drums", entry.overrides));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.body.code).toBe("idempotency_conflict");
      expect(adapter.calls).toHaveLength(1);
    });
  }

  it("reports a conflict for a different skill and target under the same key", async () => {
    const { deps, adapter } = harness([goodRound("drums")]);
    await runCopilot(deps, arrangeRequest("drums"));

    const outcome = await runCopilot(deps, arrangeRequest("bass"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.body.code).toBe("idempotency_conflict");
    expect(adapter.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// request shape and response body
// ---------------------------------------------------------------------------
describe("request shape", () => {
  it("tells a bad envelope from a bad song", async () => {
    const { deps } = harness([goodRound("drums")]);

    const badEnvelope = await runCopilot(deps, { operation: "arrange_track" });
    expect(badEnvelope.ok).toBe(false);
    if (badEnvelope.ok) return;
    expect(badEnvelope.body.code).toBe("invalid_request");

    const badSong = await runCopilot(deps, {
      ...arrangeRequest("drums"),
      song: { ...TEST_SONG, bpm: 9000 },
    });
    expect(badSong.ok).toBe(false);
    if (badSong.ok) return;
    expect(badSong.body.code).toBe("song_invalid");
  });

  it("refuses the removed section-wide operations outright", async () => {
    const { deps, adapter } = harness([goodRound("drums")]);
    for (const operation of ["insert_section", "replace_section", "generation"]) {
      const outcome = await runCopilot(deps, {
        ...arrangeRequest("drums"),
        operation,
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.body.code).toBe("invalid_request");
    }
    expect(adapter.calls).toHaveLength(0);
  });
});

describe("the response body", () => {
  it("carries nothing but the contract", async () => {
    const { deps } = harness([goodRound("drums")]);
    const outcome = await runCopilot(deps, arrangeRequest("drums"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const body: CopilotSuccessBody = outcome.body;
    expect(Object.keys(body).sort()).toEqual([
      "cached",
      "patch",
      "requestId",
      "warnings",
    ]);
  });
});
