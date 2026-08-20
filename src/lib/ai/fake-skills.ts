/**
 * Three deterministic arrangers, standing in for a provider.
 *
 * These make no claim to be good music. Their job is to answer the contract:
 * to produce, for each skill, an answer that is the right shape for the right
 * surface, built only from the context that skill is allowed to read. That is
 * what lets the change surface be proved end to end before anything is paid
 * for.
 *
 * Every one of them is a pure function of the section it is given. No clock,
 * no randomness: the same section always produces the same part, so a test
 * that runs a skill twice can compare the two answers byte for byte.
 *
 * None of them writes a string or a fret. Placement is the deterministic
 * engine's job (spec 9.2, 11.1), and a fake that guessed at it would be
 * proving the wrong thing.
 */
import type { ArrangeSkill, ModelBar } from "@/lib/copilot/contract";
import { primaryGuitar } from "@/lib/copilot/compact";
import { slotCount, slotsPerNotatedBeat } from "@/lib/music/timing";
import { pitchToMidi, midiToPitch } from "@/lib/music/pitch";
import { classifyTone, parseKey } from "@/lib/music/tonality";
import type {
  Bar,
  DrumSlot,
  MelodicSlot,
  Section,
  Song,
  Track,
} from "@/lib/song/schema";

/** Where a melodic track is struck in a bar, and how hard. */
type Onset = { slotIndex: number; pitches: string[]; accented: boolean };

function onsetsOf(bar: Bar, trackId: string): Onset[] {
  const slots = bar.slots[trackId];
  if (slots === undefined) return [];

  const onsets: Onset[] = [];
  slots.forEach((slot, slotIndex) => {
    if (slot === null || slot === "-" || Array.isArray(slot)) return;
    onsets.push({
      slotIndex,
      pitches: slot.notes.map((note) => note.pitch),
      accented: slot.notes.some(
        (note) => note.articulation === "accent" || (note.velocity ?? 0) >= 100,
      ),
    });
  });
  return onsets;
}

function emptyMelodic(count: number): MelodicSlot[] {
  return Array.from({ length: count }, () => null);
}

function emptyDrums(count: number): DrumSlot[] {
  return Array.from({ length: count }, () => []);
}

/**
 * Drums: a kick under the guitar's accents, a snare on the backbeat, a hat on
 * the beat. It reads the guitar's rhythm and nothing else — not its pitches,
 * because a drummer has no use for them.
 */
function drumBar(bar: Bar, guitarId: string | undefined): DrumSlot[] {
  const count = slotCount(bar.timeSignature, bar.resolution);
  const slots = emptyDrums(count);
  const perBeat = slotsPerNotatedBeat(bar.timeSignature, bar.resolution);

  const accents = new Set(
    guitarId === undefined
      ? []
      : onsetsOf(bar, guitarId)
          .filter((onset) => onset.accented || onset.slotIndex === 0)
          .map((onset) => onset.slotIndex),
  );

  for (let index = 0; index < count; index += 1) {
    const hits: DrumSlot = [];
    const onBeat = index % perBeat === 0;
    const beat = Math.floor(index / perBeat);

    if (onBeat) hits.push({ piece: "closed_hat" });
    if (accents.has(index)) hits.push({ piece: "kick" });
    else if (onBeat && beat === 0 && accents.size === 0) hits.push({ piece: "kick" });
    if (onBeat && beat % 2 === 1) hits.push({ piece: "snare" });

    slots[index] = hits;
  }
  return slots;
}

/**
 * Bass: the lowest note of each guitar onset, dropped an octave and held until
 * the next onset. It follows the guitar's motion without doubling every note
 * of it, which is the trait the style cards ask for.
 */
function bassBar(bar: Bar, guitarId: string | undefined, floorMidi: number): MelodicSlot[] {
  const count = slotCount(bar.timeSignature, bar.resolution);
  const slots = emptyMelodic(count);
  if (guitarId === undefined) return slots;

  const onsets = onsetsOf(bar, guitarId);
  onsets.forEach((onset, index) => {
    const lowest = onset.pitches
      .map((pitch) => pitchToMidi(pitch))
      .filter((midi): midi is number => midi !== null)
      .sort((a, b) => a - b)[0];
    if (lowest === undefined) return;

    // Down an octave, but never below what the instrument can reach.
    let midi = lowest - 12;
    while (midi < floorMidi) midi += 12;
    const pitch = midiToPitch(midi);
    if (!pitch) return;

    slots[onset.slotIndex] = { notes: [{ pitch }] };

    // Hold until the next guitar onset, or to the end of the bar.
    const nextSlot = onsets[index + 1]?.slotIndex ?? count;
    for (let tie = onset.slotIndex + 1; tie < nextSlot; tie += 1) {
      slots[tie] = "-";
    }
  });

  return slots;
}

/**
 * Harmony: a core-scale third above the guitar's top note, on the accented
 * onsets only. Colour tones are left alone rather than harmonised, and the
 * unaccented onsets are left silent so the part does not shadow the guitar
 * note for note.
 *
 * It is also the one fake that writes expression (spec 8.5): the downbeat is
 * accented and the bar's last harmony note is left ringing with vibrato.
 * Both are context-free, so this fixture can never produce an articulation
 * whose context does not hold — proving the contract carries expression
 * without teaching a bad habit.
 */
function harmonyBar(bar: Bar, guitarId: string | undefined, song: Song): MelodicSlot[] {
  const count = slotCount(bar.timeSignature, bar.resolution);
  const slots = emptyMelodic(count);
  const key = parseKey(song.key);
  if (guitarId === undefined || !key) return slots;

  const written: number[] = [];

  for (const onset of onsetsOf(bar, guitarId)) {
    if (!onset.accented && onset.slotIndex !== 0) continue;

    const top = onset.pitches
      .map((pitch) => pitchToMidi(pitch))
      .filter((midi): midi is number => midi !== null)
      .sort((a, b) => b - a)[0];
    if (top === undefined) continue;

    // Three or four semitones up, whichever lands in the declared scale.
    const candidate = [3, 4].find((step) => {
      const pitch = midiToPitch(top + step);
      return pitch !== null && classifyTone(pitch, key).kind === "core";
    });
    if (candidate === undefined) continue;

    const pitch = midiToPitch(top + candidate);
    if (!pitch) continue;
    slots[onset.slotIndex] = {
      notes: [
        onset.slotIndex === 0
          ? { pitch, articulation: "accent" as const }
          : { pitch },
      ],
    };
    written.push(onset.slotIndex);
  }

  // The last note of the bar rings on, so it is given a vibrato.
  const last = written[written.length - 1];
  if (last !== undefined && last !== 0) {
    const slot = slots[last];
    if (slot && slot !== "-" && slot.notes[0]) {
      slots[last] = {
        notes: [{ ...slot.notes[0], articulation: "vibrato" as const }],
      };
    }
  }

  return slots;
}

/** The lowest pitch a fretted track can reach, for the bass fallback. */
function floorOf(track: Track): number {
  const open = (track.fretboard?.tuning ?? [])
    .map((pitch) => pitchToMidi(pitch))
    .filter((midi): midi is number => midi !== null);
  return open.length === 0 ? 0 : Math.min(...open) + (track.fretboard?.capo ?? 0);
}

export type SkillInput = {
  song: Song;
  section: Section;
  target: Track;
  skill: ArrangeSkill;
};

/** The bars one skill would write for one section. Pure and repeatable. */
export function arrangeBars(input: SkillInput): ModelBar[] {
  const { song, section, target, skill } = input;
  const guitarId = primaryGuitar(song, target.id)?.id;

  return section.bars.map((bar, barIndex): ModelBar => {
    if (skill === "drums") {
      return { barIndex, slots: drumBar(bar, guitarId) };
    }
    if (skill === "bass") {
      return { barIndex, slots: bassBar(bar, guitarId, floorOf(target)) };
    }
    return { barIndex, slots: harmonyBar(bar, guitarId, song) };
  });
}

/** The whole answer, as a provider would return it: JSON text. */
export function arrangeAnswer(
  input: SkillInput & { sectionId: string; explanation?: string },
): string {
  return JSON.stringify({
    operation: "arrange_track",
    sectionId: input.sectionId,
    targetTrackId: input.target.id,
    bars: arrangeBars(input),
    explanation:
      input.explanation ?? `Deterministik ${input.skill} duzenlemesi.`,
  });
}
