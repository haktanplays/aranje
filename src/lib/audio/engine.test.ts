import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { drumTrackIds, melodicTrackIds } from "@/lib/audio/tracks";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const ENGINE_SOURCE = readFileSync("src/lib/audio/engine.ts", "utf8");

/**
 * Tone's `Transport` and `Destination` exports are bound to whichever context
 * existed when the module was first imported. Under an offline render they
 * point at the wrong graph and the result is silence. The engine must take its
 * context by injection, so these names are banned outright.
 */
describe("no stale context singletons (spec 8.3)", () => {
  const code = ENGINE_SOURCE.split("\n")
    .filter((line) => !line.trim().startsWith("*"))
    .join("\n");

  it.each([
    ["Tone.Transport", /\bTone\.Transport\b/],
    ["Tone.Destination", /\bTone\.Destination\b/],
    ["toDestination()", /\.toDestination\s*\(/],
    ["getTransport()", /\bgetTransport\s*\(/],
    ["getDestination()", /\bgetDestination\s*\(/],
  ])("never reaches for %s", (_name, pattern) => {
    expect(pattern.test(code)).toBe(false);
  });

  it("takes the transport from the injected context", () => {
    expect(code).toContain("engine.context.transport");
  });

  it("lands the master on the injected destination", () => {
    expect(code).toContain("context.destination");
  });

  it("builds every node on the injected context", () => {
    // Nodes come from the lazily loaded module, and each constructor is handed
    // the context as its first option.
    //
    // `ToneAudioBuffers` is the one exception, and it is not a node: it is a
    // bag of decoded samples, with no input and no output, so it has no
    // context option to be given (spec 8.5). Everything that makes a sound
    // still gets one.
    const constructors = code.match(/new tone\.\w+\(\{/g) ?? [];
    expect(constructors.length).toBeGreaterThan(5);
    const withoutContext = (
      code.match(/new tone\.\w+\((?!\{\s*\n?\s*context)/g) ?? []
    ).filter((match) => !match.startsWith("new tone.ToneAudioBuffers("));
    expect(withoutContext).toEqual([]);
  });

  it("starts the context only through the live entry point", () => {
    // Starting the context belongs to the gesture-driven path, nowhere else.
    expect(code.match(/tone\.start\(\)/g)).toHaveLength(1);
    expect(code).toContain("createLiveEngine");
  });

  it("keeps Tone out of the server render", () => {
    // A value import would pull Tone in during prerender, where there is no
    // window. The module is fetched on demand instead.
    expect(code).toContain('import type * as Tone from "tone"');
    expect(/^import \* as Tone from "tone"/m.test(code)).toBe(false);
    expect(code).toContain('import("tone")');
  });
});

describe("track partitioning for isolated renders", () => {
  it("separates drums from the melodic tracks", () => {
    expect(drumTrackIds(SAMPLE_SONG)).toEqual(["drums"]);
    expect(melodicTrackIds(SAMPLE_SONG)).toEqual(["gtr", "acc", "bass"]);
  });

  it("covers every track between them", () => {
    const all = [
      ...melodicTrackIds(SAMPLE_SONG),
      ...drumTrackIds(SAMPLE_SONG),
    ].sort();
    expect(all).toEqual(SAMPLE_SONG.tracks.map((t) => t.id).sort());
  });
});

describe("one bank, every reader (spec 8.5, 8.1, K-28)", () => {
  const code = ENGINE_SOURCE.split("\n")
    .filter((line) => !line.trim().startsWith("*"))
    .join("\n");
  const bankCode = readFileSync("src/lib/audio/buffer-bank.ts", "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("*"))
    .join("\n");

  it("decodes the pack once and hands the sampler buffers, not urls", () => {
    // Exactly one place is given a url map and a baseUrl, and it is the
    // shared bank rather than the engine.
    expect(code).not.toContain("new tone.ToneAudioBuffers({");
    expect(bankCode).toContain("new tone.ToneAudioBuffers({");
    const bank = bankCode.slice(bankCode.indexOf("new tone.ToneAudioBuffers({"));
    expect(bank.slice(0, 200)).toContain("urls: pack.urls");
    expect(bank.slice(0, 200)).toContain("baseUrl: pack.baseUrl");

    // The sampler is built from that bank, so nothing is requested twice.
    const sampler = code.slice(code.indexOf("new tone.Sampler({"));
    expect(sampler.slice(0, 300)).toContain("buffers.get(note)");
    expect(sampler.slice(0, 300)).not.toContain("baseUrl");
  });

  it("is keyed by the pack, not by the track", () => {
    // A track-keyed cache is what made two guitars decode the same seven
    // files twice in the S-01 rehearsal.
    expect(bankCode).toContain("packs.get(pack.id)");
    expect(bankCode).not.toContain("track.id");
  });

  it("releases rather than disposes, so one track cannot silence another", () => {
    expect(code).toContain("voice.bank.release()");
    expect(code).not.toContain("voice.buffers.dispose()");
  });

  it("never reaches into Tone's private fields for those buffers", () => {
    expect(/\._buffers\b/.test(code)).toBe(false);
    expect(/\._activeSources\b/.test(code)).toBe(false);
  });

  it("never detunes a shared voice", () => {
    // Track-wide detune would bend the whole chord (spec 8.5).
    expect(/sampler\.detune/.test(code)).toBe(false);
    expect(/channel\.detune/.test(code)).toBe(false);
    expect(/\.playbackRate/.test(code)).toBe(false);
  });
});
