/**
 * The ten things the founder is asked to listen to (2W §3, §4; 2V-B.3 §7).
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
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { planSelectionIteration } from "@/lib/playback/selection-iteration";
import { barTimeline } from "@/lib/audio/schedule";
import { secondsAtTicks, type TempoMap } from "@/lib/audio/tempo";
import type { PlaybackWindow } from "@/lib/playback/selection-playback";
import type { GestureTakeId, GestureTakes } from "@/lib/listening/gesture-take";
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
  | "L8"
  | "L9"
  | "L10"
  | "L11"
  | "L12"
  | "L13"
  | "L14"
  | "L15"
  | "L16";

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

/**
 * L10's music: the same shape as L8's B side, and for the same reason.
 *
 * It is a second Song rather than a second window, because the fast run is
 * music this batch's own command wrote. When the command refuses, the card is
 * not offered at all — an L10 with nothing in it would be a question the
 * founder could not answer.
 */
export type SequenceSide = ChordSide;

export function listeningClips(
  song: Song,
  chord: ChordSide | null,
  sequence: SequenceSide | null = null,
  gestures: GestureTakes | null = null,
): ListeningClip[] {
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

  /*
   * L9 · the extended chord's loop return (2V-B.3 §7).
   *
   * The founder heard this by hand: a selection opened in the middle of the
   * held opening chord and looped, and the chord's tail was there on the
   * first pass and gone from the second wrap on. So the clip is four passes
   * of one selection, back to back and with nothing between them, and the
   * only question is whether they sound the same as each other.
   *
   * The passes are not written out four times. Each one is
   * `planSelectionIteration` of the *same* selection — the value the live
   * controller reads on its first play and on every wrap — so if the plan and
   * the loop ever diverged again, this clip would diverge with them rather
   * than keep sounding correct.
   */
  const loop = extendedChordSelection(song, support);
  if (loop) {
    const iteration = planSelectionIteration({
      startTicks: loop.startTicks,
      endTicks: loop.endTicks,
      trackIds: [guitar],
      sustainCount: loop.sustainCount,
    });
    const pass = (): ClipSegment => ({
      window: { ...loop, trackIds: [guitar] },
      continueSustained: iteration.continues,
      /* No tail between passes: a gap the loop does not have would be a
         musical event this clip invented. The last pass gets one. */
      tailSeconds: 0,
    });
    const passes = [pass(), pass(), pass(), { ...pass(), tailSeconds: 2 }];
    clips.push({
      id: "L9",
      label: "Uzayan akorun loop dönüşü",
      instruction: "Aynı kısa bölüm arka arkaya dört kez çalınıyor.",
      question: "Dört turda da akor kuyruğu aynı şekilde geliyor mu?",
      answers: LISTENING_ANSWERS,
      takes: [{ id: "L9", name: "Dinle · 4 tur", segments: passes }],
      expects: { trackIds: [guitar], minSeconds: 2, maxSeconds: 14 },
    });
  }

  /*
   * L10 · the fast connected run (2V-B.3, "Hızlı dizi").
   *
   * One short context and one question. The bar opens with two ordinary
   * eighths, the `9–10–9` goes into the third, and the note after it arrives
   * on the beat it was always on — so all three parts of "did it speed up
   * without stretching anything" are in one listen. The founder chooses no
   * subdivision, enters no notes and performs no editor gesture.
   */
  if (sequence) {
    clips.push({
      id: "L10",
      label: "Hızlı bağlı dizi (\"9–10–9\")",
      instruction: "Önce normal ritim, sonra aynı süreye sığan hızlı dizi.",
      question: "9–10–9 doğal biçimde hızlanıp tek bir bağlı gitar hareketi gibi duyuluyor mu?",
      answers: LISTENING_ANSWERS,
      takes: [
        {
          id: "L10",
          name: "Dinle",
          segments: [
            plain(
              bars(sequence.song, sequence.barNumber, sequence.barNumber + 1, [guitar]),
              2,
            ),
          ],
        },
      ],
      expects: { trackIds: [guitar], minSeconds: 2, maxSeconds: 7 },
    });
  }

  /*
   * L11–L16 · the guitar gestures this batch made expressible (2V-C.1 §19).
   *
   * Each card is one question with the two sides differing in exactly one
   * thing, so a "yes" is about that thing and nothing else. All ten takes are
   * written by the production command; if even one could not be, no card is
   * offered, because a comparison with a side missing cannot be made.
   */
  if (gestures) {
    const gestureClip = (
      id: ListeningClipId,
      label: string,
      instruction: string,
      question: string,
      takes: readonly { readonly id: GestureTakeId; readonly name: string }[],
    ): ListeningClip => ({
      id,
      label,
      instruction,
      question,
      answers: LISTENING_ANSWERS,
      takes: takes.map((take) => ({
        id: take.id,
        name: take.name,
        segments: [
          plain(
            bars(
              gestures[take.id].song,
              gestures[take.id].barNumber,
              gestures[take.id].barNumber + 1,
              [gestures[take.id].trackId],
            ),
            2,
          ),
        ],
      })),
      expects: {
        trackIds: [gestures[takes[0]!.id].trackId],
        minSeconds: 1.5,
        maxSeconds: 8,
      },
    });

    clips.push(
      gestureClip(
        "L11",
        "Bend: tut / geri indir",
        "Aynı nota, aynı miktar. Yalnız sonu farklı.",
        "İlkinde bend yukarıda kalıyor, ikincisinde başlangıç notasına geri dönüyor mu?",
        [
          { id: "L11a", name: "Yukarıda tut" },
          { id: "L11b", name: "Geri indir" },
        ],
      ),
      gestureClip(
        "L12",
        "Önceden bükme: tut / geri indir",
        "İkisi de bükülmüş perdeden başlamalı.",
        "İki ses de yukarı kaymadan bükülmüş perdeden mi başlıyor; ikincisi sonra aşağı iniyor mu?",
        [
          { id: "L12a", name: "Önceden bük" },
          { id: "L12b", name: "Önceden bük ve indir" },
        ],
      ),
      gestureClip(
        "L13",
        "Bağlı / vurarak kaydırma",
        "Aynı mesafe, aynı süre. Yalnız hedefteki atak farklı.",
        "Bağlı slide'da hedef yeniden vurulmadan geliyor, vurarak slide'da hedefte yeni atak duyuluyor mu?",
        [
          { id: "L13a", name: "Bağlı" },
          { id: "L13b", name: "Vurarak" },
        ],
      ),
      gestureClip(
        "L14",
        "Kayarak girme / çıkma",
        "Tek nota; biri kayarak giriyor, öteki kayarak çıkıyor.",
        "İlk nota kayarak içeri giriyor, ikinci nota kayarak dışarı çıkıyor mu?",
        [
          { id: "L14a", name: "İçeri" },
          { id: "L14b", name: "Dışarı" },
        ],
      ),
      gestureClip(
        "L15",
        "Bend + tepede vibrato",
        "Önce hedefe varış, sonra tepede titreşim.",
        "Nota önce tam bend hedefine ulaşıp ardından tepede vibratoya mı geçiyor?",
        [{ id: "L15", name: "Dinle" }],
      ),
      gestureClip(
        "L16",
        "Bükülmüş sesin devamı",
        "Bükülmüş nota ölçü sınırını geçiyor.",
        "Bükülmüş perde sınırda düz notaya düşmeden devam ediyor mu?",
        [{ id: "L16", name: "Dinle" }],
      ),
    );
  }

  return clips;
}

/**
 * Where the founder's own selection was: inside the held chord, reaching the
 * note after it.
 *
 * Read off the plan the engine plays rather than written down, for the same
 * reason every other clip is: the chord has to still be *sounding* at the
 * window's start for there to be anything to lose, and only the plan knows
 * how long the planner really gave it.
 */
function extendedChordSelection(
  song: Song,
  support: SongSupport,
): { startTicks: number; endTicks: number; sustainCount: number } | null {
  const held = support.heldPowerChord;
  if (!held) return null;
  const plan = buildExpressionPlan(song);
  const voices = plan.notes.filter(
    (note) =>
      note.trackId === held.trackId &&
      note.barKey === held.barKey &&
      note.slotIndex === held.slotIndex,
  );
  const first = voices[0];
  if (!first) return null;

  const next = plan.notes
    .filter(
      (note) => note.trackId === held.trackId && note.timeTicks > first.timeTicks,
    )
    .sort((left, right) => left.timeTicks - right.timeTicks)[0];
  if (!next) return null;

  /* Halfway into the chord, which is where a finger lands when someone drags
     a selection across a note they can see. */
  const startTicks = Math.round((first.timeTicks + next.timeTicks) / 2);
  const stillRinging = voices.filter(
    (voice) => voice.timeTicks + voice.durationTicks > startTicks,
  );
  if (stillRinging.length === 0) return null;

  return {
    startTicks,
    /* Past the following note's onset, so each pass has to deliver both the
       tail that is at risk and the event that was never at risk. */
    endTicks: next.timeTicks + next.durationTicks,
    sustainCount: stillRinging.length,
  };
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
