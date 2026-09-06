/**
 * Home's two states, and what a card is allowed to say (2V-E.1 §4).
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_HOME_BLURB,
  NEW_SONG_CTA,
  homeModel,
} from "@/lib/home/home-model";
import { FIRST_SONG_TEMPLATE, startingAssumptions } from "@/lib/home/first-song";
import { NEW_PROJECT_TITLE } from "@/lib/projects/project-names";
import { summarizeSong, unreadableSummary } from "@/lib/projects/project-summary";
import { materializeTemplate, TEMPLATE_DEFAULTS } from "@/lib/song/song-templates";
import type { Song } from "@/lib/song/schema";

const NOW = Date.UTC(2026, 8, 6, 19, 14);

const song = (over: Partial<Song> = {}): Song => {
  const base = materializeTemplate("empty");
  if (!base) throw new Error("the empty template did not materialise");
  return { ...base, ...over };
};

const summary = (
  id: string,
  over: { title?: string; isActive?: boolean; updatedAt?: number | null } = {},
) =>
  summarizeSong(id, song(over.title === undefined ? {} : { title: over.title }), {
    isActive: over.isActive ?? false,
    updatedAt: over.updatedAt === undefined ? NOW : over.updatedAt,
  });

describe("395. Home with nothing on the device", () => {
  it("asks one question and explains it in one sentence", () => {
    const model = homeModel([], NOW);
    expect(model.kind).toBe("empty");
    if (model.kind !== "empty") return;
    expect(model.cta).toBe(NEW_SONG_CTA);
    expect(model.blurb).toBe(EMPTY_HOME_BLURB);
  });

  it("says what the reader will get, not what the app is", () => {
    /* No storage word, no error word, no theory question: an empty device is
       a new reader, not a fault. */
    expect(EMPTY_HOME_BLURB).not.toMatch(/hata|depolama|proje bulunamadı|kayıt/i);
    expect(EMPTY_HOME_BLURB).toMatch(/riff/i);
  });
});

describe("396. Home with projects on the device", () => {
  const projects = [
    summary("project-1", { title: "İlk Riffim", updatedAt: NOW - 90_000 }),
    summary("project-2", { title: "Köprü denemesi", isActive: true, updatedAt: NOW - 10 }),
    summary("project-3", { title: "Eski fikir", updatedAt: NOW - 5_000_000 }),
  ];

  it("puts the open project first, on its own", () => {
    const model = homeModel(projects, NOW);
    expect(model.kind).toBe("library");
    if (model.kind !== "library") return;
    expect(model.recent?.title).toBe("Köprü denemesi");
    expect(model.recent?.isActive).toBe(true);
    expect(model.others.map((card) => card.title)).toEqual([
      "İlk Riffim",
      "Eski fikir",
    ]);
  });

  it("falls back to the most recently saved when nothing is open", () => {
    const closed = projects.map((entry) => ({ ...entry, isActive: false }));
    const model = homeModel(closed, NOW);
    if (model.kind !== "library") throw new Error("expected a library");
    expect(model.recent?.title).toBe("Köprü denemesi");
  });

  it("never repeats the recent project in the rest of the list", () => {
    const model = homeModel(projects, NOW);
    if (model.kind !== "library") throw new Error("expected a library");
    expect(model.others.some((card) => card.id === model.recent?.id)).toBe(false);
    expect(model.others).toHaveLength(projects.length - 1);
  });
});

describe("397. what a project card may say", () => {
  const [card] = (() => {
    const model = homeModel([summary("project-7", { title: "İlk Riffim" })], NOW);
    if (model.kind !== "library" || !model.recent) throw new Error("no card");
    return [model.recent];
  })();

  it("names the music by what it sounds like", () => {
    expect(card.title).toBe("İlk Riffim");
    expect(card.musicLine).toBe("E minor · 120 BPM · 4/4");
    expect(card.shapeLine).toBe("1 bölüm · 4 ölçü · 1 track");
    expect(card.whenLine).toMatch(/Bugün/);
  });

  it("shows no id, revision, hash or storage key anywhere on it", () => {
    /* Every string the card carries, in one place, checked together: a field
       added later is caught by this rather than by a reader seeing it. */
    const shown = [card.title, card.musicLine, card.shapeLine, card.whenLine, card.label]
      .filter((value): value is string => value !== null)
      .join(" | ");
    expect(shown).not.toContain("project-7");
    expect(shown).not.toMatch(/aranje\.|revision|hash|localStorage|slot|tick/i);
  });

  it("gives a screen reader the name before the shape", () => {
    expect(card.label.startsWith("İlk Riffim.")).toBe(true);
  });

  it("says a project cannot be opened rather than showing it as empty", () => {
    const model = homeModel([unreadableSummary("project-9", "unreadable", false)], NOW);
    if (model.kind !== "library" || !model.recent) throw new Error("no card");
    expect(model.recent.unreadable).toBe(true);
    expect(model.recent.musicLine).toBeNull();
    expect(model.recent.shapeLine).not.toMatch(/0 ölçü/);
  });
});

describe("398. what one tap starts", () => {
  it("starts from a template that really exists and really plays", () => {
    const made = materializeTemplate(FIRST_SONG_TEMPLATE);
    expect(made).not.toBeNull();
    expect(made?.tracks).toHaveLength(1);
    expect(made?.tracks[0]?.name).toBe("Gitar 1");
  });

  it("shows the assumptions it is making, read off that template", () => {
    const rows = startingAssumptions();
    const table = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(table.Ad).toBe(NEW_PROJECT_TITLE);
    expect(table.Ton).toBe(TEMPLATE_DEFAULTS.key);
    expect(table.Tempo).toBe("120 BPM");
    expect(table["Ölçü"]).toBe("4/4");
    expect(table["İlk bölüm"]).toBe("Giriş · 4 ölçü");
    expect(table["İlk enstrüman"]).toContain("Gitar 1");
  });

  it("shows nothing a reader would have to look up", () => {
    const shown = startingAssumptions()
      .map((row) => `${row.label} ${row.value}`)
      .join(" ");
    expect(shown).not.toMatch(/PPQ|resolution|slot|tick|schema|track-|section-/i);
  });
});
