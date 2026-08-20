/**
 * What a turn can see of the rest of the piece (spec 11.5, K-32).
 *
 * K-18 narrowed the data layer to one section, which was the right call for
 * the risk it was managing — a whole Song in a prompt is expensive and mostly
 * irrelevant. But S-01 showed what it cost: a turn asked to "develop the
 * previous section's motif" was shown `bar 1: -sus-` for every bar of the
 * only track it could see. The task was not merely hard, it was unanswerable,
 * and the rehearsal had to smuggle the motif into the user instruction as
 * prose. That is a workaround for a missing input, and it is exactly what
 * this closes.
 *
 * So a turn now sees the *shape* of the piece — form, tempo, motifs, what
 * happened immediately before it and what has to happen after — while still
 * not seeing the whole Song.
 *
 * ## Minimisation is still the rule
 *
 * What travels is a summary, per role, and the rule is unchanged: a role sees
 * what it needs to do its job and nothing else.
 *
 *   drums            no pitches at all, ever — onsets, accents and rests
 *   rhythm_guitar    the drum groove; not the lead's detail
 *   lead_guitar      the backing it plays over, with pitches
 *   acoustic_guitar  where the previous section landed, so it can take it up
 *   harmony          the guitar it supports
 *   bass             the guitar's pitches and the drum groove
 *
 * The previous section's *landing* is given to everyone, because every role
 * has to join on from something; it is one line, not a section.
 */
import { rhythmLines, trackLines } from "@/lib/copilot/compact";
import { buildTempoMap, sectionBpm } from "@/lib/audio/tempo";
import { instrumentFamily } from "@/lib/instruments/registry";
import type { ArrangeSkill } from "@/lib/copilot/contract";
import type { Section, Song, Track } from "@/lib/song/schema";

export type SectionOutline = {
  id: string;
  name: string;
  bars: number;
  bpm: number;
  /** True for the section this turn is writing into. */
  target: boolean;
};

export type SourceSummary = {
  /** Reader-facing: "gitar (lead_gtr)", "davul ritmi (drums)". */
  label: string;
  lines: readonly string[];
};

export type ArrangementContext = {
  /** Every section in playing order, with its own tempo. */
  form: readonly SectionOutline[];
  /** The whole piece, in seconds, at the tempos it is written at. */
  totalSeconds: number;
  targetStartSeconds: number;
  /** The last bar of the section before this one, for the target track. */
  previousLanding: readonly string[];
  /** The first bar of the section after this one, if it has been written. */
  nextEntry: readonly string[];
  /** How the target track ended the previous section it played in. */
  targetPreviously: readonly string[];
  /** Role-filtered readings of the other tracks in this section. */
  sources: readonly SourceSummary[];
};

/** Which other tracks this role is allowed to read, and how (K-32). */
function sourcesFor(
  song: Song,
  section: Section,
  role: ArrangeSkill,
  target: Track,
): SourceSummary[] {
  const others = song.tracks.filter((track) => track.id !== target.id);
  const guitars = others.filter(
    (track) => instrumentFamily(track.instrumentId) === "guitar",
  );
  const drums = others.find(
    (track) => instrumentFamily(track.instrumentId) === "drums",
  );

  const rhythmOf = (track: Track): SourceSummary => ({
    label: `ritim (${track.id})`,
    lines: rhythmLines(section, track.id),
  });
  const pitchesOf = (track: Track): SourceSummary => ({
    label: `gitar (${track.id})`,
    lines: trackLines(section, track.id),
  });

  switch (role) {
    // Never a pitch. A drum part is written against where the accents fall.
    case "drums":
      return guitars.map(rhythmOf);

    // The riff is written against the groove, not against the lead's detail.
    case "rhythm_guitar":
      return drums ? [rhythmOf(drums)] : [];

    // A solo needs to know what it is playing over, harmonically.
    case "lead_guitar":
      return [
        ...guitars.map(pitchesOf),
        ...(drums ? [rhythmOf(drums)] : []),
      ];

    // A coda is usually alone; if anything else is here, its pitches matter.
    case "acoustic_guitar":
      return guitars.map(pitchesOf);

    // A supporting part is written against the part it supports.
    case "harmony":
      return guitars.slice(0, 1).map(pitchesOf);

    case "bass":
      return [
        ...guitars.slice(0, 1).map(pitchesOf),
        ...(drums ? [rhythmOf(drums)] : []),
      ];
  }
}

/** The last written bar of a track in a section, or nothing. */
function lastBarOf(section: Section, trackId: string): string[] {
  const lines = trackLines(section, trackId);
  const last = lines[lines.length - 1];
  return last === undefined ? [] : [last];
}

function firstBarOf(section: Section, trackId: string): string[] {
  const first = trackLines(section, trackId)[0];
  return first === undefined ? [] : [first];
}

export function buildArrangementContext(
  song: Song,
  sectionId: string,
  targetTrackId: string,
  role: ArrangeSkill,
): ArrangementContext | null {
  const index = song.sections.findIndex((entry) => entry.id === sectionId);
  const section = song.sections[index];
  const target = song.tracks.find((entry) => entry.id === targetTrackId);
  if (!section || !target) return null;

  const tempo = buildTempoMap(song);
  const previous = index > 0 ? song.sections[index - 1] : undefined;
  const next = song.sections[index + 1];

  /*
   * "How did the target track leave off" is asked of the last section it
   * actually played in, not simply the one before — a lead that is silent
   * through the break should still be able to pick up its own thread.
   */
  let targetPreviously: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const earlier = song.sections[cursor];
    if (!earlier) continue;
    const plays = earlier.bars.some((bar) => bar.slots[targetTrackId] !== undefined);
    if (!plays) continue;
    targetPreviously = lastBarOf(earlier, targetTrackId);
    break;
  }

  /*
   * The previous section's landing is the loudest guitar in it — what the ear
   * was left holding. Drums are excluded: nobody joins on from a cymbal.
   */
  const landingTrack = previous
    ? song.tracks.find(
        (track) =>
          instrumentFamily(track.instrumentId) === "guitar" &&
          previous.bars.some((bar) => bar.slots[track.id] !== undefined),
      )
    : undefined;

  return {
    form: song.sections.map((entry) => ({
      id: entry.id,
      name: entry.name,
      bars: entry.bars.length,
      bpm: sectionBpm(song, entry.id),
      target: entry.id === sectionId,
    })),
    totalSeconds: tempo.totalSeconds,
    targetStartSeconds:
      tempo.segments.find((s) => s.sectionId === sectionId)?.startSeconds ?? 0,
    previousLanding:
      previous && landingTrack
        ? lastBarOf(previous, landingTrack.id).map(
            (line) => `${landingTrack.id}: ${line}`,
          )
        : [],
    nextEntry: next ? firstBarOf(next, targetTrackId) : [],
    targetPreviously,
    sources: sourcesFor(song, section, role, target),
  };
}
