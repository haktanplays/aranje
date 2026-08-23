/**
 * One project's durable record (2O-A §23).
 *
 * The claim under test is that a project keeps the guarantees the single song
 * already had — a readable rung to fall back to, a revision that only counts
 * up, a newer version's file left alone — and keeps them *because it shares
 * the same reader*, not because a second implementation happens to agree.
 */
import { describe, expect, it } from "vitest";

import { legacySong, otherSong } from "../../../eval/projects/fixtures";

import { sameSong } from "@/lib/song/edit-history";
import {
  PROJECT_RECORD_FORMAT,
  PROJECT_RECORD_VERSION,
  decideRecord,
  nextRecord,
  serializeRecord,
} from "@/lib/projects/project-record";

const NOW = 1_700_000_000_000;

const record = (current: unknown, previous: unknown, revision = 3) =>
  JSON.stringify({
    format: PROJECT_RECORD_FORMAT,
    version: PROJECT_RECORD_VERSION,
    projectId: "project-1",
    revision,
    updatedAt: NOW,
    current,
    previous,
  });

describe("122. a project record reads like the song envelope, because it is one", () => {
  it("reads a healthy record", () => {
    const decision = decideRecord(record(legacySong(), otherSong()));
    expect(decision.kind).toBe("record");
    if (decision.kind !== "record") return;
    expect(decision.song.title).toBe("Eski Şarkı");
    expect(decision.previous?.title).toBe("İkinci Şarkı");
    expect(decision.projectId).toBe("project-1");
    expect(decision.revision).toBe(3);
  });

  it("falls back to previous when current is unreadable", () => {
    const decision = decideRecord(record({ nope: true }, otherSong()));
    expect(decision.kind).toBe("recovered_previous");
    if (decision.kind !== "recovered_previous") return;
    expect(decision.song.title).toBe("İkinci Şarkı");
  });

  it("gives up only when both slots are unreadable", () => {
    expect(decideRecord(record({ a: 1 }, { b: 2 })).kind).toBe("corrupt");
  });

  it("treats unreadable text and a foreign shape as corrupt, not empty", () => {
    expect(decideRecord("{oops").kind).toBe("corrupt");
    expect(decideRecord(JSON.stringify({ hello: 1 })).kind).toBe("corrupt");
    expect(decideRecord(null).kind).toBe("empty");
  });

  it("leaves a newer version alone and says which one", () => {
    const decision = decideRecord(
      JSON.stringify({ format: PROJECT_RECORD_FORMAT, version: 9, whatever: true }),
    );
    expect(decision).toEqual({ kind: "future_version", version: 9 });
  });

  it("refuses a record whose id is not a project id", () => {
    const bad = JSON.stringify({
      format: PROJECT_RECORD_FORMAT,
      version: PROJECT_RECORD_VERSION,
      projectId: "../elsewhere",
      revision: 1,
      updatedAt: NOW,
      current: legacySong(),
      previous: null,
    });
    expect(decideRecord(bad).kind).toBe("corrupt");
  });
});

describe("123. the revision counts up and previous is what was on disk", () => {
  it("advances the revision and demotes the song that was current", () => {
    const onDisk = decideRecord(record(legacySong(), null, 3));
    const next = nextRecord("project-1", otherSong(), onDisk, NOW + 5);
    expect(next.revision).toBe(4);
    expect(next.current.title).toBe("İkinci Şarkı");
    expect(next.previous?.title).toBe("Eski Şarkı");
    expect(next.updatedAt).toBe(NOW + 5);
  });

  it("starts at 1 on an empty slot, with nothing behind it", () => {
    const next = nextRecord("project-2", legacySong(), { kind: "empty" }, NOW);
    expect(next.revision).toBe(1);
    expect(next.previous).toBeNull();
  });

  it("keeps counting up through a rescue rather than restarting", () => {
    const rescued = decideRecord(record({ broken: true }, legacySong(), 8));
    const next = nextRecord("project-1", otherSong(), rescued, NOW);
    expect(next.revision).toBe(9);
  });

  it("round-trips byte-equal five times", () => {
    const next = nextRecord("project-1", legacySong(), { kind: "empty" }, NOW);
    const bytes = Array.from({ length: 5 }, () => serializeRecord(next));
    for (const line of bytes) expect(line).toBe(bytes[0]);
    const back = decideRecord(bytes[0]!);
    expect(back.kind).toBe("record");
    if (back.kind !== "record") return;
    /*
     * The same *music*, not the same bytes. The schema settles a note's keys
     * into its own order on the way in, so a byte comparison against a
     * hand-written fixture would fail over field order while every pitch,
     * velocity and position matched. `sameSong` is the app's own answer to
     * "is this the same piece", and it is the one the history already trusts.
     */
    expect(sameSong(back.song, legacySong())).toBe(true);
  });

  it("takes its time from a caller, never from a clock of its own", () => {
    /*
     * The only way to write a timestamp is to be handed one. Two calls with
     * the same argument are byte-equal, which they could not be if anything
     * in here read `Date.now`.
     */
    const a = serializeRecord(nextRecord("project-1", legacySong(), { kind: "empty" }, 1));
    const b = serializeRecord(nextRecord("project-1", legacySong(), { kind: "empty" }, 1));
    expect(a).toBe(b);
    expect(a).not.toBe(
      serializeRecord(nextRecord("project-1", legacySong(), { kind: "empty" }, 2)),
    );
  });

  it("keeps the timestamp out of the song", () => {
    const next = nextRecord("project-1", legacySong(), { kind: "empty" }, NOW);
    expect(sameSong(next.current, legacySong())).toBe(true);
    expect(JSON.stringify(next.current)).not.toContain(String(NOW));
  });
});
