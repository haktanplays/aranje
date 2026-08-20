/**
 * One decoded copy per pack, per context (spec 8.1, K-28).
 *
 * Tone is faked, so what is checked is the thing that matters and that an
 * offline render cannot see: how many times a pack was *constructed*, and who
 * is still holding it.
 */
import { describe, expect, it } from "vitest";

import { acquireBank, banksHeld } from "@/lib/audio/buffer-bank";
import type { SamplePack } from "@/lib/audio/packs";

function fakeTone() {
  const built: { urls: Record<string, string>; disposed: number }[] = [];
  const tone = {
    ToneAudioBuffers: class {
      disposed = 0;
      urls: Record<string, string>;
      constructor(options: { urls: Record<string, string>; onload: () => void }) {
        this.urls = options.urls;
        built.push(this as unknown as { urls: Record<string, string>; disposed: number });
        options.onload();
      }
      dispose() {
        this.disposed += 1;
      }
    },
  } as unknown as typeof import("tone");
  return { tone, built };
}

const pack = (id: string, files: number): SamplePack =>
  ({
    id,
    baseUrl: `/samples/${id}`,
    urls: Object.fromEntries(
      Array.from({ length: files }, (_, i) => [`N${i}`, `N${i}.mp3`]),
    ),
    bytes: 0,
    trimDb: 0,
  }) as SamplePack;

/** Contexts are only ever used as cache keys here. */
const context = () => ({}) as never;

describe("two tracks on the same pack", () => {
  it("decode it once", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);

    const rhythm = acquireBank(tone, ctx, gtr, () => {});
    const lead = acquireBank(tone, ctx, gtr, () => {});

    expect(built).toHaveLength(1);
    expect(rhythm.buffers).toBe(lead.buffers);
    expect(rhythm.consumers()).toBe(2);
    expect(rhythm.bufferCount).toBe(7);
  });

  it("keep playing when one of them goes away", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);

    const rhythm = acquireBank(tone, ctx, gtr, () => {});
    const lead = acquireBank(tone, ctx, gtr, () => {});

    rhythm.release();
    expect(built[0]?.disposed).toBe(0);
    expect(lead.consumers()).toBe(1);
    expect(banksHeld(ctx)).toBe(1);
  });

  it("free it once the last one lets go", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);

    const rhythm = acquireBank(tone, ctx, gtr, () => {});
    const lead = acquireBank(tone, ctx, gtr, () => {});

    rhythm.release();
    lead.release();
    expect(built[0]?.disposed).toBe(1);
    expect(banksHeld(ctx)).toBe(0);
  });

  it("cannot be freed twice by the same holder", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);

    const rhythm = acquireBank(tone, ctx, gtr, () => {});
    const lead = acquireBank(tone, ctx, gtr, () => {});

    rhythm.release();
    rhythm.release();
    // The double release must not have taken the lead's reference with it.
    expect(built[0]?.disposed).toBe(0);
    expect(lead.consumers()).toBe(1);
  });

  it("build a fresh bank after the last release", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);

    acquireBank(tone, ctx, gtr, () => {}).release();
    acquireBank(tone, ctx, gtr, () => {});
    expect(built).toHaveLength(2);
  });
});

describe("what is not shared", () => {
  it("a different pack gets its own bank", () => {
    const { tone, built } = fakeTone();
    const ctx = context();

    acquireBank(tone, ctx, pack("electric_guitar/high_gain", 7), () => {});
    acquireBank(tone, ctx, pack("steel_acoustic/finger", 8), () => {});

    expect(built).toHaveLength(2);
    expect(built[0]?.urls).not.toEqual(built[1]?.urls);
    expect(banksHeld(ctx)).toBe(2);
  });

  it("a different context gets its own bank", () => {
    const { tone, built } = fakeTone();
    const gtr = pack("electric_guitar/high_gain", 7);
    const live = context();
    const offline = context();

    const a = acquireBank(tone, live, gtr, () => {});
    const b = acquireBank(tone, offline, gtr, () => {});

    // A buffer belongs to the context that decoded it; sharing one across
    // contexts would hand an offline render the live engine's audio.
    expect(built).toHaveLength(2);
    expect(a.buffers).not.toBe(b.buffers);
    expect(banksHeld(live)).toBe(1);
    expect(banksHeld(offline)).toBe(1);
  });

  it("disposing one context leaves the other's bank alone", () => {
    const { tone, built } = fakeTone();
    const gtr = pack("electric_guitar/high_gain", 7);
    const live = context();
    const offline = context();

    const a = acquireBank(tone, live, gtr, () => {});
    acquireBank(tone, offline, gtr, () => {});

    a.release();
    expect(built[0]?.disposed).toBe(1);
    expect(built[1]?.disposed).toBe(0);
    expect(banksHeld(offline)).toBe(1);
  });
});
