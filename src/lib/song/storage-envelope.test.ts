/**
 * What a stored file means, and what may be done about it (spec 13.14, K-45).
 *
 * Every branch here only happens when something has already gone wrong, which
 * is exactly why they need testing: they are the paths nobody exercises by
 * using the app, and the paths where a mistake costs a musician their work
 * rather than a redraw.
 *
 * `decideLoad` is pure, so each case is an exact input and an exact answer.
 */
import { describe, expect, it } from "vitest";

import { guitarTrack, restSlots, section, song as makeSong } from "@/lib/song/fixtures";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  decideLoad,
  nextEnvelope,
  SONG_ENVELOPE_FORMAT,
  SONG_ENVELOPE_VERSION,
} from "@/lib/song/storage-envelope";
import type { Bar, Song } from "@/lib/song/schema";

const bar = (): Bar => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: { gtr: restSlots(8) },
});

const songNamed = (title: string): Song => ({
  ...makeSong([guitarTrack({ id: "gtr" })], [section([bar()])]),
  title,
});

/** A well-formed envelope, so a test can break exactly one thing about it. */
const envelope = (
  current: unknown,
  previous: unknown,
  revision = 3,
  version: number = SONG_ENVELOPE_VERSION,
) =>
  JSON.stringify({
    format: SONG_ENVELOPE_FORMAT,
    version,
    revision,
    current,
    previous,
  });

describe("1. nothing stored is not a failure", () => {
  it("says so plainly", () => {
    expect(decideLoad(null)).toEqual({ kind: "empty" });
  });
});

describe("2. a raw Song from before the envelope still opens", () => {
  it("is read as legacy, not as a broken envelope", () => {
    const decision = decideLoad(JSON.stringify(SAMPLE_SONG));
    expect(decision.kind).toBe("legacy");
    if (decision.kind !== "legacy") return;
    expect(decision.song).toEqual(SAMPLE_SONG);
  });

  it("cannot be confused with an envelope in either direction", () => {
    // A Song has no `format`; an envelope has no `tracks`. Neither schema can
    // accept the other, which is what makes the ordering safe rather than lucky.
    expect(decideLoad(envelope(SAMPLE_SONG, null)).kind).toBe("envelope");
    expect(decideLoad(JSON.stringify(SAMPLE_SONG)).kind).toBe("legacy");
  });
});

describe("3. a healthy envelope opens its current slot", () => {
  it("returns the song, the revision and the previous", () => {
    const current = songNamed("Şimdi");
    const previous = songNamed("Önce");
    const decision = decideLoad(envelope(current, previous, 7));
    expect(decision.kind).toBe("envelope");
    if (decision.kind !== "envelope") return;
    expect(decision.song.title).toBe("Şimdi");
    expect(decision.previous?.title).toBe("Önce");
    expect(decision.revision).toBe(7);
  });

  it("opens even when the previous slot is the broken one", () => {
    const decision = decideLoad(envelope(songNamed("Şimdi"), { junk: true }));
    expect(decision.kind).toBe("envelope");
    if (decision.kind !== "envelope") return;
    expect(decision.song.title).toBe("Şimdi");
    // Nothing to fall back to any more, and that is said rather than hidden.
    expect(decision.previous).toBeNull();
  });
});

describe("4. a broken current slot is what previous is for", () => {
  it("recovers the older song rather than losing both", () => {
    const decision = decideLoad(envelope({ half: "written" }, songNamed("Önce"), 4));
    expect(decision.kind).toBe("recovered_previous");
    if (decision.kind !== "recovered_previous") return;
    expect(decision.song.title).toBe("Önce");
    expect(decision.revision).toBe(4);
  });

  it("gives up only when both slots are unreadable", () => {
    expect(decideLoad(envelope({ a: 1 }, { b: 2 })).kind).toBe("corrupt");
    expect(decideLoad(envelope({ a: 1 }, null)).kind).toBe("corrupt");
  });
});

describe("5. unreadable text is corrupt, and nothing more is claimed", () => {
  it("does not throw on malformed JSON", () => {
    expect(decideLoad("{not json").kind).toBe("corrupt");
    expect(decideLoad("").kind).toBe("corrupt");
    expect(decideLoad("[]").kind).toBe("corrupt");
  });
});

describe("6. the outer object is strict", () => {
  it("refuses an envelope with a key this version does not know", () => {
    const raw = JSON.stringify({
      format: SONG_ENVELOPE_FORMAT,
      version: SONG_ENVELOPE_VERSION,
      revision: 1,
      current: songNamed("A"),
      previous: null,
      extra: "surprise",
    });
    expect(decideLoad(raw).kind).toBe("corrupt");
  });

  it("refuses a negative or fractional revision", () => {
    expect(decideLoad(envelope(songNamed("A"), null, -1)).kind).toBe("corrupt");
    expect(decideLoad(envelope(songNamed("A"), null, 1.5)).kind).toBe("corrupt");
  });

  it("accepts revision zero", () => {
    expect(decideLoad(envelope(songNamed("A"), null, 0)).kind).toBe("envelope");
  });
});

describe("7. a newer version is not corrupt", () => {
  it("is recognised by its tag, whatever shape the rest is", () => {
    const decision = decideLoad(
      JSON.stringify({
        format: SONG_ENVELOPE_FORMAT,
        version: 2,
        // A shape this version has never seen. That is the point.
        chunks: [{ kind: "song", body: "…" }],
      }),
    );
    expect(decision.kind).toBe("unsupported_version");
    if (decision.kind !== "unsupported_version") return;
    expect(decision.version).toBe(2);
  });

  it("is never called corrupt, so nothing downstream quarantines it", () => {
    expect(decideLoad(envelope({ a: 1 }, { b: 2 }, 1, 9)).kind).toBe(
      "unsupported_version",
    );
  });
});

describe("8. the next envelope keeps one rung to climb back to", () => {
  it("puts the song that was on disk into previous", () => {
    const onDisk = decideLoad(envelope(songNamed("Bir"), songNamed("Sıfır"), 5));
    const next = nextEnvelope(songNamed("İki"), onDisk);
    expect(next.current.title).toBe("İki");
    expect(next.previous?.title).toBe("Bir");
    expect(next.revision).toBe(6);
  });

  it("carries a legacy song forward instead of dropping it", () => {
    const onDisk = decideLoad(JSON.stringify(SAMPLE_SONG));
    const next = nextEnvelope(songNamed("İlk düzenleme"), onDisk);
    expect(next.previous).toEqual(SAMPLE_SONG);
    expect(next.revision).toBe(1);
  });

  it("has nothing to keep when the key was empty or unreadable", () => {
    for (const onDisk of [decideLoad(null), decideLoad("{broken")]) {
      const next = nextEnvelope(songNamed("A"), onDisk);
      expect(next.previous).toBeNull();
      expect(next.revision).toBe(1);
    }
  });

  it("counts up from a rescue, so the revision never goes backwards", () => {
    const onDisk = decideLoad(envelope({ broken: true }, songNamed("Önce"), 11));
    const next = nextEnvelope(songNamed("Sonra"), onDisk);
    expect(next.revision).toBe(12);
    expect(next.previous?.title).toBe("Önce");
  });

  it("writes the tag it claims", () => {
    const next = nextEnvelope(songNamed("A"), decideLoad(null));
    expect(next.format).toBe(SONG_ENVELOPE_FORMAT);
    expect(next.version).toBe(SONG_ENVELOPE_VERSION);
  });
});

describe("9. the decision is a value", () => {
  it("gives the same answer five times over", () => {
    const raw = envelope({ broken: true }, songNamed("Önce"), 2);
    const runs = Array.from({ length: 5 }, () => JSON.stringify(decideLoad(raw)));
    expect(new Set(runs).size).toBe(1);
  });

  it("does not mutate the song it is handed", () => {
    const song = songNamed("A");
    const before = JSON.stringify(song);
    nextEnvelope(song, decideLoad(envelope(songNamed("B"), null)));
    expect(JSON.stringify(song)).toBe(before);
  });
});
