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

  it("builds nodes on the injected context", () => {
    // Every node constructor in the engine passes the context through.
    const constructors = code.match(/new Tone\.\w+\(\{/g) ?? [];
    expect(constructors.length).toBeGreaterThan(5);
    const withoutContext = code.match(/new Tone\.\w+\((?!\{\s*\n?\s*context)/g);
    expect(withoutContext).toBeNull();
  });

  it("starts the context only through the live entry point", () => {
    // Tone.start() belongs to the gesture-driven path, nowhere else.
    expect(code.match(/Tone\.start\(\)/g)).toHaveLength(1);
    expect(code).toContain("createLiveEngine");
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
