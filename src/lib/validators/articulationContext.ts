/**
 * Articulations whose context does not hold (spec 10.3, 8.5, K-21).
 *
 * A slide, a hammer-on and a pull-off are not properties of a note on their
 * own — each one is a claim about the note before it. A hammer-on with nothing
 * under it, or one written downwards, is not an error in the song: it is a
 * note that will simply be played plainly, and the musician deserves to be
 * told why rather than left wondering where the sound went.
 *
 * So this only ever warns. Playback falls back to an ordinary onset with the
 * same fixed reason this reports, because both read the context from the same
 * helper (`@/lib/music/legato`).
 *
 * What it refuses to do
 * ---------------------
 * - It says nothing about drums. Melodic articulation is not a drum property.
 * - It does not invent behaviour for a phase 2.5 instrument with no fretboard.
 *   Those are reported as deferred once per track, not once per note.
 * - It reports one issue per note, not one per symptom, so a single wrong
 *   hammer-on does not fill the list.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import { legatoDecision } from "@/lib/audio/legato-chain";
import { legatoLink, trackLegatoOnsets } from "@/lib/music/legato";
import { isExpressive, needsPrevious } from "@/lib/audio/expression";
import { expressionPresets } from "@/lib/audio/expression";
import type { Song } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const ARTICULATION_CONTEXT_CODE = "articulationContext";

/** The reader-facing name of each articulation (spec 13.9). */
export const ARTICULATION_LABELS: Readonly<Record<string, string>> = {
  normal: "Normal",
  sustain: "Uzatma",
  staccato: "Staccato",
  accent: "Vurgu",
  palm_mute: "Palm mute",
  vibrato: "Vibrato",
  bend_half: "Yarım bend",
  bend_full: "Tam bend",
  slide: "Slide",
  hammer_on: "Hammer-on",
  pull_off: "Pull-off",
};

export function articulationLabel(articulation: string): string {
  return ARTICULATION_LABELS[articulation] ?? articulation;
}

export const validateArticulationContext: Validator = (song: Song) => {
  const issues: ValidationIssue[] = [];
  const sectionNames = new Map(
    song.sections.map((section) => [section.id, section.name]),
  );

  for (const track of song.tracks) {
    if (isDrumInstrument(track.instrumentId)) continue;

    if (!track.fretboard) {
      // One line per track, not per note: the instrument is what is deferred.
      const carries = song.sections.some((section) =>
        section.bars.some((bar) => {
          const slots = bar.slots[track.id];
          if (!Array.isArray(slots)) return false;
          return slots.some(
            (slot) =>
              slot !== null &&
              slot !== "-" &&
              !Array.isArray(slot) &&
              slot.notes.some((note) => isExpressive(note.articulation)),
          );
        }),
      );
      if (!carries) continue;

      issues.push({
        code: ARTICULATION_CONTEXT_CODE,
        severity: "warning",
        message:
          `"${track.name}" için ifade çalma henüz tanımlı değil: bu enstrümanın ` +
          `akordu yok, bu yüzden articulation'lar normal çalınır.`,
        trackId: track.id,
      });
      continue;
    }

    const onsets = trackLegatoOnsets(song, track.id);

    onsets.forEach((onset, index) => {
      const articulation = onset.articulation;
      if (!isExpressive(articulation)) return;

      const where =
        `"${sectionNames.get(onset.sectionId) ?? onset.sectionId}" bölümü, bar ` +
        `${onset.barIndex + 1}, slot ${onset.slotIndex + 1}`;

      const report = (message: string) => {
        issues.push({
          code: ARTICULATION_CONTEXT_CODE,
          severity: "warning",
          message,
          sectionId: onset.sectionId,
          barIndex: onset.barIndex,
          trackId: track.id,
          slotIndex: onset.slotIndex,
        });
      };

      // Accent, palm mute, vibrato and both bends only need a fretted note,
      // and on this track every note has one by construction.
      if (!needsPrevious(articulation)) return;

      const name = articulationLabel(articulation);

      if (articulation === "slide") {
        const link = legatoLink(onsets, index);
        if (link.kind === "other_string") {
          report(
            `${where}: ${onset.pitch} notasındaki ${name} için önceki nota aynı ` +
              `telde değil; normal çalınacak.`,
          );
          return;
        }
        if (link.kind === "none") {
          report(
            `${where}: ${onset.pitch} notasındaki ${name} bir önceki nota ile ` +
              `bağlanamıyor; normal çalınacak.`,
          );
          return;
        }
        const previous = link.previous;
        if (previous.midi === null || onset.midi === null) return;
        const interval = Math.abs(previous.midi - onset.midi);
        if (interval > expressionPresets.slide.maxIntervalSemitones) {
          report(
            `${where}: ${previous.pitch} ile ${onset.pitch} arası ${interval} ` +
              `yarım ton; bir oktavdan geniş bir ${name} normal çalınacak.`,
          );
        }
        return;
      }

      // Hammer-on and pull-off are decided by the same helper the renderer
      // uses, so a warning here and a fallback there can never disagree.
      const decision = legatoDecision(onsets, index);
      if (!decision || decision.kind === "joined") return;

      switch (decision.reason) {
        case "previous_note_other_string":
          report(
            `${where}: ${onset.pitch} notasındaki ${name} için önceki nota aynı ` +
              `telde değil; normal çalınacak.`,
          );
          return;
        case "no_previous_note":
          report(
            `${where}: ${onset.pitch} notasındaki ${name} bir önceki nota ile ` +
              `bağlanamıyor; normal çalınacak.`,
          );
          return;
        case "wrong_direction":
          report(
            articulation === "hammer_on"
              ? `${where}: ${name} yalnız yukarı yönde çalınır; ${onset.pitch} ` +
                  `normal çalınacak.`
              : `${where}: ${name} yalnız aşağı yönde çalınır; ${onset.pitch} ` +
                  `normal çalınacak.`,
          );
          return;
        case "interval_too_wide":
          report(
            `${where}: ${name} en fazla ` +
              `${expressionPresets.legato.maxIntervalSemitones} yarım ton ` +
              `uzağa bağlanır; ${onset.pitch} normal çalınacak.`,
          );
          return;
        default:
          report(
            `${where}: ${onset.pitch} notasındaki ${name} bu bağlamda ` +
              `çalınamıyor; normal çalınacak.`,
          );
      }
    });
  }

  return issues;
};
