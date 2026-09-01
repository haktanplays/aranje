/**
 * Where a track sits in the stereo field (spec 5.2, 8.1, K-29).
 *
 * Phase 2G audited this rather than assuming it. The finding was that it
 * already worked: `track.pan` is written to the track's `Channel`, and every
 * source a track has — the sampler, each expressive primary voice, and the
 * pull-off's auxiliary transient — is connected to that same channel. So no
 * second system was built. These pin the behaviour instead, because "it
 * happens to be right" is not the same as "it cannot quietly stop being
 * right".
 *
 * The offline proof lives outside these tests: rendering the S-01 song stem
 * by stem gives L-R of +4.25 dB for a track panned -0.3, -3.50 dB for one
 * panned +0.25, and 0.00 dB for the two with no pan at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { trackSchema } from "@/lib/song/schema";
import { surfaceDigest } from "@/lib/copilot/scope";
import { modelPatchSchema } from "@/lib/copilot/contract";
import { MODEL_PATCH_JSON_SCHEMA } from "@/lib/copilot/output-schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const ENGINE = readFileSync("src/lib/audio/engine.ts", "utf8");
const VOICE = readFileSync("src/lib/audio/expressive-voice.ts", "utf8");

const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");

describe("one bus per track", () => {
  const engine = withoutComments(ENGINE);
  const voice = withoutComments(VOICE);

  it("puts the pan on the track's channel and nowhere else", () => {
    expect(engine).toContain("channel.pan.value = track.pan");
    /*
     * 2L-C added a second write — the mixer's runtime setter, which moves a
     * live track's position without rebuilding the graph. The claim this test
     * exists to defend is unchanged and is now stated directly: every pan
     * write in the engine lands on a track's own channel, so there is still
     * exactly one bus per track and no second panning system.
     */
    const all = engine.match(/\.pan\.value/g) ?? [];
    const onChannel = engine.match(/channel\.pan\.value/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(onChannel).toHaveLength(all.length);
    expect(/new .*\.Panner/.test(engine)).toBe(false);
  });

  it("sends every source of a track to that same channel", () => {
    // The sampler.
    expect(engine).toContain("sampler.connect(channel)");
    // The expressive voices: primary, auxiliary and filtered alike, all
    // through the host's destination, which is the track's channel.
    expect(engine).toContain("destination: voice.channel");
    /*
     * Four sites since 2V-B.1 §7, and it is worth naming which four so the
     * next reader does not have to count them: the struck note (`play`), the
     * struck legato chain (`playChain`), the finger's own click
     * (`playAuxiliary`), and the tail of a sound a pause interrupted
     * (`resumeOne`). The fourth is a real voice — it opens a buffer source,
     * it makes sound, and it therefore has to reach the track's channel like
     * the other three.
     */
    expect(voice.match(/gain\.connect\(host\.destination\)/g) ?? []).toHaveLength(4);
    /*
     * And the invariant itself, said directly rather than through a count.
     * A fifth voice added tomorrow may raise the number above; what it may
     * not do is send a gain anywhere other than the host's destination,
     * because that would be a second bus for one track.
     */
    const everyGainConnect = voice.match(/gain\.connect\([^)]*\)/g) ?? [];
    expect(everyGainConnect).toEqual(
      everyGainConnect.map(() => "gain.connect(host.destination)"),
    );
  });

  it("never pans a single note", () => {
    // A per-note panner would put one note of a chord somewhere else.
    expect(/new .*\.Panner/.test(voice)).toBe(false);
    expect(/\bpan\b/.test(voice)).toBe(false);
  });

  it("keeps the master graph after the bus, not around it", () => {
    expect(engine).toContain("channel.connect(master)");
  });
});

describe("what pan is allowed to be", () => {
  it("takes its range from the Song Contract, not from a component", () => {
    expect(trackSchema.safeParse({ ...track(), pan: -1 }).success).toBe(true);
    expect(trackSchema.safeParse({ ...track(), pan: 1 }).success).toBe(true);
    expect(trackSchema.safeParse({ ...track(), pan: -1.01 }).success).toBe(false);
    expect(trackSchema.safeParse({ ...track(), pan: 1.01 }).success).toBe(false);
  });

  it("defaults to the centre by being absent", () => {
    const parsed = trackSchema.safeParse(track());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.pan).toBeUndefined();
  });
});

describe("pan is locked (spec 11.1)", () => {
  it("is part of the surface an arrange patch may not move", () => {
    const moved = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((entry, index) =>
        index === 0 ? { ...entry, pan: 0.9 } : entry,
      ),
    };
    expect(surfaceDigest(SAMPLE_SONG).tracks).not.toBe(surfaceDigest(moved).tracks);
  });

  it("has nowhere in the answer schema to be written", () => {
    expect(JSON.stringify(MODEL_PATCH_JSON_SCHEMA)).not.toContain('"pan"');
    expect(
      modelPatchSchema.safeParse({
        operation: "arrange_track",
        sectionId: "s",
        targetTrackId: "t",
        bars: [{ barIndex: 0, slots: [] }],
        explanation: "x",
        pan: 0.5,
      }).success,
    ).toBe(false);
  });
});

function track() {
  return {
    id: "gtr",
    name: "Guitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    volumeDb: -3,
  };
}
