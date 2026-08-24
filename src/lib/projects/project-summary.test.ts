/**
 * What the list says about a project (2O-A §23, §27).
 *
 * The summary is derived from the project's own song, every time. The
 * alternative — a shape cached in the catalog — is right until the first edit
 * and wrong for ever after, and the reader has no way to tell which they are
 * looking at. So these tests read the *song* and compare.
 */
import { describe, expect, it } from "vitest";

import { legacySong } from "../../../eval/projects/fixtures";

import { projectShape, projectWhen, projectRowLabel } from "@/lib/projects/project-copy";
import { summarizeSong, unreadableSummary } from "@/lib/projects/project-summary";
import type { Song } from "@/lib/song/schema";

const NOW = new Date("2026-08-24T22:14:00Z").getTime();

const bigger = (): Song => ({
  ...legacySong(),
  sections: [
    ...legacySong().sections,
    { ...legacySong().sections[0]!, id: "s2", name: "İkinci" },
  ],
});

describe("141. the shape comes from the song, not from a note about it", () => {
  it("counts the sections, bars and tracks that are really there", () => {
    const song = bigger();
    const summary = summarizeSong("project-1", song, { isActive: true, updatedAt: NOW });
    const bars = song.sections.reduce((sum, section) => sum + section.bars.length, 0);

    expect(summary.sectionCount).toBe(song.sections.length);
    expect(summary.barCount).toBe(bars);
    expect(summary.trackCount).toBe(song.tracks.length);
    expect(projectShape(summary)).toBe(
      `${song.sections.length} bölüm · ${bars} ölçü · ${song.tracks.length} track`,
    );
  });

  it("follows the song when the song changes", () => {
    // The whole reason nothing is cached: an edit must be visible immediately.
    const before = summarizeSong("project-1", legacySong(), {
      isActive: false,
      updatedAt: null,
    });
    const after = summarizeSong("project-1", bigger(), {
      isActive: false,
      updatedAt: null,
    });
    expect(after.sectionCount).toBe((before.sectionCount ?? 0) + 1);
    expect(after.barCount).toBeGreaterThan(before.barCount ?? 0);
  });

  it("takes its name from the song's title and nowhere else", () => {
    const summary = summarizeSong("project-7", legacySong(), {
      isActive: false,
      updatedAt: null,
    });
    expect(summary.title).toBe("Eski Şarkı");
    expect(projectRowLabel(summary)).toContain("Eski Şarkı");
    // The id is a storage detail and has no business in an accessible name.
    expect(projectRowLabel(summary)).not.toContain("project-7");
  });

  it("says a project is open in words, not only in colour", () => {
    const open = summarizeSong("project-1", legacySong(), {
      isActive: true,
      updatedAt: null,
    });
    expect(projectRowLabel(open)).toContain("açık");
  });

  it("is deterministic and mutates nothing", () => {
    const song = bigger();
    const snapshot = JSON.stringify(song);
    const first = summarizeSong("project-1", song, { isActive: false, updatedAt: NOW });
    const second = summarizeSong("project-1", song, { isActive: false, updatedAt: NOW });
    expect(second).toEqual(first);
    expect(JSON.stringify(song)).toBe(snapshot);
  });
});

describe("142. a project it cannot read is not a project with no music", () => {
  it("shows no counts at all rather than zeroes", () => {
    /*
     * "0 ölçü" reads as "this project is empty", which is the opposite of
     * what happened to it. The row has to say the record could not be opened.
     */
    const broken = unreadableSummary("project-2", "unreadable", false);
    expect(broken.barCount).toBeNull();
    expect(projectShape(broken)).not.toMatch(/0 ölçü/);
    expect(projectShape(broken)).toContain("açılamadı");
  });

  it("says a newer version wrote it, without naming a format or a number", () => {
    const future = unreadableSummary("project-3", "future_version", false);
    const shape = projectShape(future);
    expect(shape).toContain("daha yeni");
    expect(shape).not.toMatch(/version|format|aranje\./i);
  });
});

describe("143. the time is the caller's, and never guessed", () => {
  it("shows nothing when nothing recorded a time", () => {
    const summary = summarizeSong("project-1", legacySong(), {
      isActive: false,
      updatedAt: null,
    });
    expect(projectWhen(summary, NOW)).toBeNull();
  });

  it("says today when it was today, and a date when it was not", () => {
    const today = summarizeSong("project-1", legacySong(), {
      isActive: false,
      updatedAt: NOW,
    });
    expect(projectWhen(today, NOW)).toMatch(/^Bugün /);

    const older = summarizeSong("project-1", legacySong(), {
      isActive: false,
      updatedAt: NOW - 5 * 24 * 60 * 60 * 1000,
    });
    const text = projectWhen(older, NOW);
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/^Bugün/);
  });
});
