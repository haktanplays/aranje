/**
 * The section lifecycle commands (spec 13.17, 2L-B §6).
 *
 * Seven pure commands over the section list. The structural rules are the
 * ones the rest of the codebase already lives by, read from where they
 * already live: bar and section limits from `lib/limits`, which meter can be
 * written on which grid from `timing.ts`, and "a missing track key is
 * silence" from spec 5.5 — a new section carries no track keys at all, and a
 * duplicate carries exactly the keys its source had.
 *
 * Nothing here decides what the UI does afterwards. Which section becomes
 * active after a delete is `survivorIndex`'s answer; whether the loop
 * survives is the playback normalisation's business, fed by the same song
 * this returns.
 */
import { bpmRange, songLimits } from "@/lib/limits";
import { isRepresentableGrid } from "@/lib/music/timing";
import { guardCandidate } from "@/lib/song/lifecycle-guard";
import { copyName, dedupeId, nextNumberedId } from "@/lib/song/lifecycle-ids";
import type {
  Bar,
  Resolution,
  Section,
  Song,
  TimeSignature,
} from "@/lib/song/schema";
import type { LifecycleResult } from "@/lib/song/lifecycle-types";

/** Where a new section lands. */
export type SectionPosition =
  | { readonly kind: "before"; readonly sectionId: string }
  | { readonly kind: "after"; readonly sectionId: string }
  | { readonly kind: "end" };

export type SectionCommand =
  | {
      readonly kind: "create_section";
      readonly name: string;
      readonly position: SectionPosition;
      readonly barCount: number;
      readonly timeSignature: TimeSignature;
      readonly resolution: Resolution;
      readonly bpmOverride?: number;
    }
  | {
      readonly kind: "rename_section";
      readonly sectionId: string;
      readonly name: string;
    }
  | { readonly kind: "duplicate_section"; readonly sectionId: string }
  | {
      readonly kind: "move_section";
      readonly sectionId: string;
      readonly direction: "up" | "down";
    }
  | { readonly kind: "delete_section"; readonly sectionId: string }
  | {
      readonly kind: "set_section_tempo_override";
      readonly sectionId: string;
      readonly bpm: number;
    }
  | {
      readonly kind: "clear_section_tempo_override";
      readonly sectionId: string;
    };

const totalBars = (song: Song): number =>
  song.sections.reduce((sum, section) => sum + section.bars.length, 0);

const sectionIndex = (song: Song, sectionId: string): number =>
  song.sections.findIndex((section) => section.id === sectionId);

const withSections = (song: Song, sections: readonly Section[]): Song => ({
  ...song,
  sections: [...sections],
});

export function applySectionCommand(
  song: Song,
  command: SectionCommand,
): LifecycleResult {
  switch (command.kind) {
    case "create_section": {
      const name = command.name.trim();
      if (name.length === 0) {
        return { ok: false, error: { code: "invalid_section_name" } };
      }
      if (
        !Number.isInteger(command.barCount) ||
        command.barCount < 1 ||
        command.barCount > songLimits.barsPerSection
      ) {
        return { ok: false, error: { code: "bar_count_out_of_range" } };
      }
      if (totalBars(song) + command.barCount > songLimits.totalBars) {
        return { ok: false, error: { code: "song_bar_limit_reached" } };
      }
      if (!isRepresentableGrid(command.timeSignature, command.resolution)) {
        return { ok: false, error: { code: "grid_not_representable" } };
      }
      if (
        command.bpmOverride !== undefined &&
        (!Number.isFinite(command.bpmOverride) ||
          command.bpmOverride < bpmRange.min ||
          command.bpmOverride > bpmRange.max)
      ) {
        return { ok: false, error: { code: "bpm_out_of_range" } };
      }

      let insertAt = song.sections.length;
      if (command.position.kind !== "end") {
        const anchor = sectionIndex(song, command.position.sectionId);
        if (anchor < 0) {
          return { ok: false, error: { code: "section_not_found" } };
        }
        insertAt = command.position.kind === "before" ? anchor : anchor + 1;
      }

      // Silence, stated the honest way: no track keys at all (spec 5.5).
      const bars: Bar[] = Array.from({ length: command.barCount }, () => ({
        timeSignature: command.timeSignature,
        resolution: command.resolution,
        slots: {},
      }));
      const section: Section = {
        id: nextNumberedId(
          song.sections.map((entry) => entry.id),
          "section",
        ),
        name,
        status: "fixed",
        ...(command.bpmOverride !== undefined
          ? { bpmOverride: command.bpmOverride }
          : {}),
        bars,
      };
      const sections = [...song.sections];
      sections.splice(insertAt, 0, section);
      return guardCandidate(withSections(song, sections));
    }

    case "rename_section": {
      const name = command.name.trim();
      if (name.length === 0) {
        return { ok: false, error: { code: "invalid_section_name" } };
      }
      const index = sectionIndex(song, command.sectionId);
      if (index < 0) return { ok: false, error: { code: "section_not_found" } };
      const sections = song.sections.map((section, at) =>
        at === index ? { ...section, name } : section,
      );
      return guardCandidate(withSections(song, sections));
    }

    case "duplicate_section": {
      const index = sectionIndex(song, command.sectionId);
      if (index < 0) return { ok: false, error: { code: "section_not_found" } };
      const source = song.sections[index]!;
      if (totalBars(song) + source.bars.length > songLimits.totalBars) {
        return { ok: false, error: { code: "song_bar_limit_reached" } };
      }
      /*
       * The whole bar structure and every track's content travel: the copy
       * is the section, not an outline of it. The guard's schema parse
       * rebuilds the containers, so nothing ends up shared with the source.
       */
      const copy: Section = {
        ...source,
        id: dedupeId(
          song.sections.map((entry) => entry.id),
          `${source.id}-copy`,
        ),
        name: copyName(
          song.sections.map((entry) => entry.name),
          source.name,
        ),
        bars: source.bars.map((bar) => ({ ...bar, slots: { ...bar.slots } })),
      };
      const sections = [...song.sections];
      sections.splice(index + 1, 0, copy);
      return guardCandidate(withSections(song, sections));
    }

    case "move_section": {
      const index = sectionIndex(song, command.sectionId);
      if (index < 0) return { ok: false, error: { code: "section_not_found" } };
      const target = command.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= song.sections.length) {
        return { ok: false, error: { code: "no_room_to_move" } };
      }
      const sections = [...song.sections];
      const [moved] = sections.splice(index, 1);
      sections.splice(target, 0, moved!);
      return guardCandidate(withSections(song, sections));
    }

    case "delete_section": {
      const index = sectionIndex(song, command.sectionId);
      if (index < 0) return { ok: false, error: { code: "section_not_found" } };
      if (song.sections.length <= 1) {
        return { ok: false, error: { code: "last_section_undeletable" } };
      }
      const sections = song.sections.filter((_, at) => at !== index);
      return guardCandidate(withSections(song, sections));
    }

    case "set_section_tempo_override": {
      const index = sectionIndex(song, command.sectionId);
      if (index < 0) return { ok: false, error: { code: "section_not_found" } };
      if (
        !Number.isFinite(command.bpm) ||
        command.bpm < bpmRange.min ||
        command.bpm > bpmRange.max
      ) {
        return { ok: false, error: { code: "bpm_out_of_range" } };
      }
      const sections = song.sections.map((section, at) =>
        at === index ? { ...section, bpmOverride: command.bpm } : section,
      );
      return guardCandidate(withSections(song, sections));
    }

    case "clear_section_tempo_override": {
      const index = sectionIndex(song, command.sectionId);
      if (index < 0) return { ok: false, error: { code: "section_not_found" } };
      const sections = song.sections.map((section, at) => {
        if (at !== index) return section;
        const { bpmOverride: _cleared, ...rest } = section;
        return rest;
      });
      return guardCandidate(withSections(song, sections));
    }
  }
}
