/**
 * The eight things the founder is asked to listen to (2W §3, §4).
 *
 * ## Why this file exists at all
 *
 * The founder has spent several rounds performing a thirteen-step editor
 * ritual — long presses, copies, undos, redos — to produce answers that were
 * mostly about whether the *harness* worked. The last round of that ritual
 * failed at step 8 on a move that had actually succeeded. Copy, move, delete,
 * undo and redo are claims about bytes, and bytes are something a machine can
 * check exactly; nobody should be asked to prove them by hand.
 *
 * What a machine cannot check is whether a guitar sounds like a guitar, or
 * whether a resumed note sounds struck again. So the founder's job is now
 * only that, and this module is the list of questions.
 *
 * ## What a clip is
 *
 * A **window** on the acceptance song and the tracks it may sound, which is
 * exactly the shape the production selection playback already uses
 * (`PlaybackWindow`). Nothing here is a new musical idea: every clip is a
 * range of the song the editor round already used, chosen so the thing being
 * asked about is the loudest thing in it.
 *
 * A clip has one or two **takes**, and a take has one or more **segments**.
 * Two takes are an A/B question. Two segments are one continuous listen with
 * a boundary inside it — which is how "pause and resume" is asked without
 * asking the founder to press pause at the right moment.
 *
 * ## What is deliberately not here
 *
 * No audio, no scheduler, no context. This file is a plan: it says which
 * ticks and which tracks, and `render-clip.ts` turns that into sound through
 * the production engine. Keeping the two apart is what lets the boundaries,
 * the durations and the track scope be checked by tests that have no browser.
 */
import { songSupport, type SongSupport } from "@/lib/acceptance/song-support";
import { barTimeline } from "@/lib/audio/schedule";
import { secondsAtTicks, type TempoMap } from "@/lib/audio/tempo";
import type { PlaybackWindow } from "@/lib/playback/selection-playback";
import type { Song } from "@/lib/song/schema";

/** How the founder may answer. Three words, and never a technical one. */
export const LISTENING_ANSWERS = ["Olmuş", "Kısmen", "Olmamış"] as const;
export type ListeningAnswer = (typeof LISTENING_ANSWERS)[number];

/** L4 asks the opposite way round, so its wording is its own. */
export const RESTRIKE_ANSWERS = [
  "Hayır, doğal devam ediyor",
  "Emin değilim",
  "Evet, yeniden vuruluyor",
] as const;

export type ClipSegment = {
  readonly window: PlaybackWindow;
  /**
   * Sound what was already ringing when this segment opens.
   *
   * The production continuation path — the same one a pause/resume and a
   * mid-note selection both use. False for a segment that starts on an onset,
   * where the transport fires the note itself and a continuation would be a
   * second attack.
   */
  readonly continueSustained: boolean;
  /** Seconds rendered past the window's end so releases are not cut off. */
  readonly tailSeconds: number;
};

export type ClipTake = {
  readonly id: string;
  /** What the founder sees on the button. Never "window" or "tick". */
  readonly name: string;
  readonly segments: readonly ClipSegment[];
};

export type ListeningClipId =
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "L6"
  | "L7"
  | "L8";

export type ListeningClip = {
  readonly id: ListeningClipId;
  readonly label: string;
  /** One line telling the founder what to listen for. */
  readonly instruction: string;
  readonly question: string;
  readonly answers: readonly string[];
  readonly takes: readonly ClipTake[];
  /** What this clip is meant to contain, for the manifest and the tests. */
  readonly expects: {
    readonly trackIds: readonly string[];
    readonly minSeconds: number;
    readonly maxSeconds: number;
  };
};

/** A window on one bar range of one track set, in ticks. */
function bars(
  song: Song,
  fromBarNumber: number,
  toBarNumberExclusive: number,
  trackIds: readonly string[],
): PlaybackWindow {
  const timeline = barTimeline(song);
  const first = timeline[fromBarNumber - 1];
  const last = timeline[toBarNumberExclusive - 2];
  const startTicks = first?.time ?? 0;
  const endTicks = (last?.time ?? 0) + (last?.durationTicks ?? 0);
  return { startTicks, endTicks, trackIds };
}

const plain = (window: PlaybackWindow, tailSeconds: number): ClipSegment => ({
  window,
  continueSustained: false,
  tailSeconds,
});

const continuing = (window: PlaybackWindow, tailSeconds: number): ClipSegment => ({
  window,
  continueSustained: true,
  tailSeconds,
});

/**
 * Every clip, built from the song the editor round already uses.
 *
 * `support` locates the slide, the vibrato, the hammer-on/pull-off and the
 * held power chord by reading the song rather than by remembering where they
 * were put, so a fixture edit moves the clips with it instead of silently
 * pointing them at the wrong bar.
 */
export type ChordSide = {
  readonly song: Song;
  /** Which bar of that song the chord landed in, 1-based. */
  readonly barNumber: number;
};

export function listeningClips(song: Song, chord: ChordSide | null): ListeningClip[] {
  const support: SongSupport = songSupport(song);
  const guitar = support.slide?.trackId ?? song.tracks[0]?.id ?? "gtr";
  const everyone = support.sharedBar?.trackIds ?? song.tracks.map((track) => track.id);
  const timeline = barTimeline(song);
  const barTicks = timeline[0]?.durationTicks ?? 768;

  /* Bar numbers, read off the song rather than written down twice. */
  const slideBar = support.slide?.barNumber ?? 5;
  const legatoBar = support.legato?.barNumber ?? 6;
  const vibratoSlot = support.vibrato?.slotIndex ?? 8;
  const slotTicks = barTicks / (timeline[0]?.slotCount ?? 16);
  const slideBarStart = timeline[slideBar - 1]?.time ?? 0;
  const vibratoStart = slideBarStart + vibratoSlot * slotTicks;
  /*
   * Where L4's pause falls, and it has to be *inside* a note rather than on
   * one (2W §4). Splitting on the vibrato's own onset was tried and measured:
   * both takes came back byte-identical, because at an onset the transport
   * fires the note itself and there is nothing for the continuation path to
   * carry — so the clip asked "was it struck again?" about a boundary where
   * nothing was ringing. Two slots into the slide, the note is in flight.
   */
  const slideStart = slideBarStart + (support.slide?.slotIndex ?? 4) * slotTicks;
  const pauseAt = Math.round(slideStart + slotTicks * 2);

  const clips: ListeningClip[] = [
    {
      id: "L1",
      label: "Yalnız gitar",
      instruction: "Tek bir enstrüman çalıyor olmalı.",
      question: "Yalnız gitarı mı duyuyorsun?",
      answers: LISTENING_ANSWERS,
      takes: [
        {
          id: "L1",
          name: "Dinle",
          segments: [plain(bars(song, 1, 4, [guitar]), 1.5)],
        },
      ],
      expects: { trackIds: [guitar], minSeconds: 6, maxSeconds: 11 },
    },
    {
      id: "L2",
      label: "Gitar + bas",
      instruction: "Aynı bölüm, bu kez bas da çalıyor.",
      question:
        "Telefon hoparlöründe gitarın yanında ikinci, daha kalın partiyi ayırt edebiliyor musun?",
      answers: LISTENING_ANSWERS,
      takes: [
        {
          id: "L2",
          name: "Dinle",
          segments: [plain(bars(song, 1, 4, everyone), 1.5)],
        },
      ],
      expects: { trackIds: everyone, minSeconds: 6, maxSeconds: 11 },
    },
    {
      id: "L3",
      label: "Tutulan notanın ortasından başlama",
      instruction: "A baştan başlar; B, nota çalarken araya girer.",
      question: "B örneği notayı yeniden vurmak yerine doğal biçimde devam ediyor mu?",
      answers: LISTENING_ANSWERS,
      takes: [
        {
          id: "L3a",
          name: "A · baştan",
          segments: [plain(bars(song, 1, 3, [guitar]), 1.5)],
        },
        {
          id: "L3b",
          name: "B · ortadan",
          segments: [
            continuing(
              {
                ...bars(song, 1, 3, [guitar]),
                startTicks: Math.round(slotTicks * 2),
              },
              1.5,
            ),
          ],
        },
      ],
      expects: { trackIds: [guitar], minSeconds: 3, maxSeconds: 9 },
    },
    {
      id: "L4",
      label: "Duraklat ve devam et",
      instruction: "A kesintisiz; B'nin ortasında bir duraklama var.",
      question: "Devam ettikten sonra nota baştan vurulmuş gibi oluyor mu?",
      answers: RESTRIKE_ANSWERS,
      takes: [
        {
          id: "L4a",
          name: "A · kesintisiz",
          segments: [plain(bars(song, slideBar, slideBar + 2, [guitar]), 1.5)],
        },
        {
          id: "L4b",
          name: "B · duraklayıp devam",
          segments: [
            plain(
              { startTicks: slideBarStart, endTicks: pauseAt, trackIds: [guitar] },
              0,
            ),
            continuing(
              {
                startTicks: pauseAt,
                endTicks: slideBarStart + barTicks * 2,
                trackIds: [guitar],
              },
              1.5,
            ),
          ],
        },
      ],
      expects: { trackIds: [guitar], minSeconds: 3, maxSeconds: 9 },
    },
    {
      id: "L5",
      label: "Slide",
      instruction: "Kısa bir cümle; içinde bir kaydırma var.",
      question: "Slide doğal ve ikna edici mi?",
      answers: LISTENING_ANSWERS,
      takes: [
        {
          id: "L5",
          name: "Dinle",
          segments: [
            plain(
              { startTicks: slideBarStart, endTicks: vibratoStart, trackIds: [guitar] },
              2,
            ),
          ],
        },
      ],
      expects: { trackIds: [guitar], minSeconds: 2, maxSeconds: 7 },
    },
    {
      id: "L6",
      label: "Vibrato",
      instruction: "Tutulan tek bir nota.",
      question: "Vibrato doğal ve ikna edici mi?",
      answers: LISTENING_ANSWERS,
      takes: [
        {
          id: "L6",
          name: "Dinle",
          segments: [
            plain(
              {
                startTicks: vibratoStart,
                endTicks: slideBarStart + barTicks,
                trackIds: [guitar],
              },
              2.5,
            ),
          ],
        },
      ],
      expects: { trackIds: [guitar], minSeconds: 2, maxSeconds: 7 },
    },
    {
      id: "L7",
      label: "Hammer-on / pull-off",
      instruction: "Bir çekiç ve bir koparma, arka arkaya.",
      question: "Hammer-on ve pull-off ayrı ayrı anlaşılır ve doğal mı?",
      answers: LISTENING_ANSWERS,
      takes: [
        {
          id: "L7",
          name: "Dinle",
          segments: [plain(bars(song, legatoBar, legatoBar + 1, [guitar]), 2)],
        },
      ],
      expects: { trackIds: [guitar], minSeconds: 2, maxSeconds: 7 },
    },
  ];

  /*
   * L8's B side is music this batch wrote: the voicing the new chord flow
   * recommends, put into the song by the production chord command. It is a
   * second Song rather than a second window, so it is passed in — and when
   * it could not be built, the clip says so instead of offering an A/B pair
   * with one silent side.
   */
  clips.push({
    id: "L8",
    label: "Power chord / normal akor",
    instruction:
      chord === null
        ? "Şu an yalnız power chord dinlenebiliyor."
        : "Aynı kök, iki farklı çalınış.",
    question: "Power chord beklediğin gibi mi? Normal akor çalınabilir ve doğal mı?",
    answers: LISTENING_ANSWERS,
    takes: [
      {
        id: "L8a",
        name: "A · power chord",
        segments: [plain(bars(song, 1, 2, [guitar]), 2)],
      },
      ...(chord === null
        ? []
        : [
            {
              id: "L8b",
              name: "B · normal akor",
              segments: [
                plain(
                  bars(chord.song, chord.barNumber, chord.barNumber + 1, [guitar]),
                  2,
                ),
              ],
            },
          ]),
    ],
    expects: { trackIds: [guitar], minSeconds: 2, maxSeconds: 7 },
  });

  return clips;
}

/** How long a take runs, in seconds, on this song's own timeline. */
export function takeSeconds(take: ClipTake, tempo: TempoMap): number {
  return take.segments.reduce(
    (total, segment) => total + segmentSeconds(segment, tempo),
    0,
  );
}

export function segmentSeconds(segment: ClipSegment, tempo: TempoMap): number {
  const from = secondsAtTicks(tempo, segment.window.startTicks);
  const to = secondsAtTicks(tempo, segment.window.endTicks);
  return Math.max(0, to - from) + segment.tailSeconds;
}
