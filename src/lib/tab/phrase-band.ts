/**
 * Where the phrase band's marks go (2V-B.4 §10).
 *
 * `Section.phrases` and `phraseFragments` were domain-only: the model could
 * say "this idea runs from here to here and carries on past the screen" and
 * no reader could see it. This turns that model into positions on the same
 * axis the bars are drawn on, so the band and the music cannot disagree
 * about where a phrase is.
 *
 * ## The window clips the drawing, never the phrase
 *
 * A fragment carries the phrase's own range untouched — `phraseStartTicks`
 * and `phraseEndTicks` are the idea, `leftPx`/`widthPx` are the part of it on
 * the screen. Scrolling, zooming and mounting fewer bars change the second
 * pair and can never change the first, which is what makes "the same phrase,
 * continued" expressible instead of "two phrases that happen to be adjacent".
 *
 * Pure. A song, an axis and a window go in; positions come out.
 */
import { phraseFragments, type TickWindow } from "@/lib/song/phrase";
import { sectionById, xAtTicks, type SongAxis } from "@/lib/tab/song-axis";
import type { Song } from "@/lib/song/schema";

export type PhraseBandSpan = {
  readonly phraseId: string;
  readonly name: string;
  readonly sectionId: string;
  /** The phrase's own range in section ticks. Never clipped. */
  readonly phraseStartTicks: number;
  readonly phraseEndTicks: number;
  readonly leftPx: number;
  readonly widthPx: number;
  /** It began before the window: draw an opening continuation mark. */
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
};

/**
 * The spans to draw, for a window given in **song** ticks.
 *
 * `window` is what is actually on the screen — the mounted run of bars —
 * rather than the whole song, because the continuation marks are a statement
 * about what the reader can see.
 */
export function phraseBand(input: {
  readonly song: Song;
  readonly axis: SongAxis;
  readonly window: TickWindow;
}): readonly PhraseBandSpan[] {
  const { song, axis, window } = input;
  return song.sections.flatMap((section) => {
    if (!section.phrases || section.phrases.length === 0) return [];
    const placed = sectionById(axis, section.id);
    if (!placed) return [];
    const sectionTicks = placed.endTicks - placed.startTicks;
    /* The window, expressed in this section's own ticks. */
    const local: TickWindow = {
      fromTicks: Math.max(0, window.fromTicks - placed.startTicks),
      toTicks: Math.min(sectionTicks, window.toTicks - placed.startTicks),
    };
    return phraseFragments(section.phrases, local).flatMap((fragment) => {
      const left = xAtTicks(axis, placed.startTicks + fragment.fromTicks);
      /*
       * The end is exclusive, so the last tick of the song has no bar of its
       * own; the section's right edge stands in for it.
       */
      const right =
        xAtTicks(axis, placed.startTicks + fragment.toTicks) ??
        placed.leftPx + placed.widthPx;
      if (left === null) return [];
      return [
        {
          phraseId: fragment.phraseId,
          name: fragment.name ?? "Cümle",
          sectionId: section.id,
          phraseStartTicks: fragment.phraseStartTicks,
          phraseEndTicks: fragment.phraseEndTicks,
          leftPx: left,
          widthPx: Math.max(2, right - left),
          continuesBefore: fragment.continuesBefore,
          continuesAfter: fragment.continuesAfter,
        },
      ];
    });
  });
}
