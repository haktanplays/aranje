/**
 * L10's music, checked before anyone is asked to listen to it (2V-B.3).
 *
 * The card is only worth showing if the run is really in the song and really
 * arrived through the production command. What is asserted here is exactly
 * that: three onsets closer together than the notes around them, the anchor
 * after them on the tick it was always on, and a measure that is no longer or
 * shorter than a 4/4 measure has ever been.
 */
import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { barTimeline, buildNotatedPlan } from "@/lib/audio/schedule";
import { sequenceTake } from "@/lib/listening/sequence-take";

describe("the fast run L10 plays", () => {
  const fixture = editorFixture();
  const take = sequenceTake(fixture);

  it("was written at all", () => {
    expect(take).not.toBeNull();
  });

  it("leaves the fixture the other clips read untouched", () => {
    expect(JSON.stringify(editorFixture())).toBe(JSON.stringify(fixture));
    expect(take?.song).not.toBe(fixture);
  });

  it("puts three onsets closer together than the notes around them", () => {
    if (!take) return;
    const guitar = take.song.tracks[0]!.id;
    const bar = barTimeline(take.song)[take.barNumber - 1]!;
    const inBar = buildNotatedPlan(take.song)
      .events.filter(
        (event) =>
          event.trackId === guitar &&
          event.time >= bar.time &&
          event.time < bar.time + bar.durationTicks,
      )
      .map((event) => event.time - bar.time)
      .sort((left, right) => left - right);

    /*
     * Two ordinary eighths, then the run, then the anchor: 0, 96, 192, 224,
     * 256, 288. The run's onsets are 32 apart inside a measure whose other
     * notes are 96 apart — density, not tempo, and nothing else moved.
     */
    expect(inBar).toEqual([0, 96, 192, 224, 256, 288]);
  });

  it("keeps the measure the same length, on a finer ruler", () => {
    if (!take) return;
    const bar = barTimeline(take.song)[take.barNumber - 1]!;
    /* Twenty-four slots of 32 ticks is the same 768 a 4/4 measure always is. */
    expect(bar.durationTicks).toBe(768);
    expect(bar.resolution).toBe(24);
    expect(bar.timeSignature).toEqual([4, 4]);

    /* And exactly one measure in the song is finer than it was. */
    const finer = take.song.sections
      .flatMap((section) => section.bars)
      .filter((entry) => entry.resolution === 24);
    expect(finer).toHaveLength(1);
  });

  it("gives the clip a measure of its own rather than moving anyone else's", () => {
    if (!take) return;
    const before = editorFixture();
    const beforeBars = before.sections.flatMap((section) => section.bars);
    const afterBars = take.song.sections.flatMap((section) => section.bars);
    expect(afterBars).toHaveLength(beforeBars.length + 1);
    /*
     * Every measure the fixture already had is unchanged. Compared by value
     * rather than by serialisation: the take goes through `settle`, which
     * re-parses, and a re-parse rebuilds objects in the schema's key order —
     * a difference in the JSON text that is not a difference in the music.
     */
    expect(afterBars.slice(0, beforeBars.length)).toEqual(beforeBars);
  });

  it("connects the run rather than re-striking it", () => {
    if (!take) return;
    const guitar = take.song.tracks[0]!.id;
    /*
     * The clip's own measure, not the whole song: the fixture already carries
     * a hammer-on and a pull-off — that is what L7 is about — so counting
     * across every bar would be counting somebody else's music.
     */
    const section = take.song.sections[take.song.sections.length - 1]!;
    const bar = section.bars[section.bars.length - 1]!;
    const articulations: (string | undefined)[] = [];
    const lane = bar.slots[guitar] ?? [];
    for (const slot of lane) {
      if (slot === null || slot === "-" || Array.isArray(slot)) continue;
      for (const note of slot.notes) articulations.push(note.articulation);
    }

    /*
     * One struck note and two joined to it. That is what "tek bir bağlı
     * hareket" means, and it is exactly the claim L10 asks the founder about:
     * a run that speeds up without being hammered three times.
     */
    expect(articulations.filter((entry) => entry === "hammer_on")).toHaveLength(1);
    expect(articulations.filter((entry) => entry === "pull_off")).toHaveLength(1);
    /* The three context notes and the first of the run are plain strikes. */
    expect(articulations.filter((entry) => entry === undefined)).toHaveLength(4);
  });
});
