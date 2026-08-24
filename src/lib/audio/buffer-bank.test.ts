/**
 * One decoded copy per pack, per context (spec 8.1, K-28).
 *
 * Tone is faked, so what is checked is the thing that matters and that an
 * offline render cannot see: how many times a pack was *constructed*, and who
 * is still holding it.
 */
import { describe, expect, it } from "vitest";

import {
  acquireBank,
  banksHeld,
  getOrLoad,
  openBankRetention,
} from "@/lib/audio/buffer-bank";
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

/**
 * A stand-in pack. Fully typed rather than cast, so a field added to the
 * real thing breaks this loudly instead of arriving here as `undefined` —
 * which is exactly how a missing `bankKey` would have made two different
 * packs look like the same bank.
 */
const pack = (id: string, files: number): SamplePack => {
  const urls = Object.fromEntries(
    Array.from({ length: files }, (_, i) => [`N${i}`, `N${i}.mp3`]),
  );
  const baseUrl = `/samples/${id}`;
  return {
    id,
    baseUrl,
    urls,
    bytes: 0,
    bankKey: `${baseUrl}#${Object.entries(urls)
      .map(([note, file]) => `${note}=${file}`)
      .sort()
      .join(",")}`,
    trimDb: 0,
  };
};

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

describe("172. the key is the decoded asset set", () => {
  it("separates two packs that differ only in which files they name", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const six = pack("electric_bass/finger", 6);
    const seven = { ...six, urls: { ...six.urls, N6: "N6.mp3" } };
    const sevenKeyed: SamplePack = {
      ...seven,
      bankKey: `${seven.baseUrl}#${Object.entries(seven.urls)
        .map(([note, file]) => `${note}=${file}`)
        .sort()
        .join(",")}`,
    };

    acquireBank(tone, ctx, six, () => {});
    acquireBank(tone, ctx, sevenKeyed, () => {});
    // Same id, same baseUrl, different recordings: a bank of six is not a
    // bank of seven, whatever the pack happens to be called.
    expect(built).toHaveLength(2);
    expect(banksHeld(ctx)).toBe(2);
  });
});

describe("173. one load, however many callers", () => {
  /** A loader whose promise the test settles by hand. */
  function pendingLoader() {
    let calls = 0;
    let settle: () => void = () => {};
    let fail: (error: unknown) => void = () => {};
    const disposed = { count: 0 };
    const load = () => {
      calls += 1;
      const loaded = new Promise<void>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
      return {
        buffers: {
          dispose: () => {
            disposed.count += 1;
          },
        } as never,
        loaded,
        bufferCount: 7,
      };
    };
    return {
      load,
      disposed,
      settle: () => settle(),
      fail: (error: unknown) => fail(error),
      calls: () => calls,
    };
  }

  it("coalesces two callers arriving while the load is still in flight", async () => {
    const loader = pendingLoader();
    const ctx = context();

    const first = getOrLoad(ctx, "bank", loader.load);
    const second = getOrLoad(ctx, "bank", loader.load);
    expect(loader.calls()).toBe(1);
    expect(first.buffers).toBe(second.buffers);
    expect(first.consumers()).toBe(2);

    loader.settle();
    await expect(first.loaded).resolves.toBeUndefined();
    await expect(second.loaded).resolves.toBeUndefined();
  });

  it("does not remember a failure, so a real retry is a real load", async () => {
    const loader = pendingLoader();
    const ctx = context();

    const failed = getOrLoad(ctx, "bank", loader.load);
    loader.fail(new Error("network"));
    await expect(failed.loaded).rejects.toThrow("network");
    // The poisoned entry is gone; the handle that asked for it still works.
    expect(banksHeld(ctx)).toBe(0);

    const retry = getOrLoad(ctx, "bank", loader.load);
    expect(loader.calls()).toBe(2);
    loader.settle();
    await expect(retry.loaded).resolves.toBeUndefined();
    expect(banksHeld(ctx)).toBe(1);
  });

  it("lets a caller of the failed load go without taking the retry with it", async () => {
    const loader = pendingLoader();
    const ctx = context();

    const failed = getOrLoad(ctx, "bank", loader.load);
    loader.fail(new Error("network"));
    await expect(failed.loaded).rejects.toThrow("network");
    const retry = getOrLoad(ctx, "bank", loader.load);
    failed.release();

    expect(banksHeld(ctx)).toBe(1);
    expect(retry.consumers()).toBe(1);
  });
});

describe("174. retention keeps a bank across the engines that come and go", () => {
  it("holds it when the last consumer lets go, and disposes it when the session does", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);
    const session = openBankRetention(ctx);

    // Twenty-five auditions: engine built, chord played, engine disposed.
    for (let audition = 0; audition < 25; audition += 1) {
      acquireBank(tone, ctx, gtr, () => {}).release();
    }
    expect(built).toHaveLength(1);
    expect(built[0]?.disposed).toBe(0);
    expect(session.retained()).toBe(1);
    expect(banksHeld(ctx)).toBe(1);

    session.dispose();
    expect(built[0]?.disposed).toBe(1);
    expect(banksHeld(ctx)).toBe(0);
  });

  it("still disposes when nobody opened retention", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);

    acquireBank(tone, ctx, gtr, () => {}).release();
    acquireBank(tone, ctx, gtr, () => {}).release();
    // An offline render never opens retention, so it tears its banks down.
    expect(built).toHaveLength(2);
    expect(built[0]?.disposed).toBe(1);
  });

  it("retains nothing for another context", () => {
    const { tone, built } = fakeTone();
    const live = context();
    const offline = context();
    const gtr = pack("electric_guitar/high_gain", 7);
    const session = openBankRetention(live);

    acquireBank(tone, offline, gtr, () => {}).release();
    expect(built[0]?.disposed).toBe(1);
    expect(session.retained()).toBe(0);
    session.dispose();
  });

  it("is one per context however many times it is opened", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);

    const first = openBankRetention(ctx);
    const second = openBankRetention(ctx);
    acquireBank(tone, ctx, gtr, () => {}).release();
    expect(first.retained()).toBe(1);
    expect(second.retained()).toBe(1);

    first.dispose();
    expect(built[0]?.disposed).toBe(1);
    // Disposing the same retention twice is not somebody else's problem.
    second.dispose();
    expect(built[0]?.disposed).toBe(1);
  });

  it("does not keep a bank somebody else is still playing from", () => {
    const { tone, built } = fakeTone();
    const ctx = context();
    const gtr = pack("electric_guitar/high_gain", 7);
    const session = openBankRetention(ctx);

    const song = acquireBank(tone, ctx, gtr, () => {});
    acquireBank(tone, ctx, gtr, () => {}).release();
    expect(session.retained()).toBe(0);
    expect(song.consumers()).toBe(1);

    session.dispose();
    // The song's own engine is untouched by the preview session ending.
    expect(built[0]?.disposed).toBe(0);
    song.release();
    expect(built[0]?.disposed).toBe(1);
  });
});
