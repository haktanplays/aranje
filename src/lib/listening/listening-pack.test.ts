/**
 * The listening pack's plan, its measurements and its report (2W §3-§6).
 *
 * Everything here is checkable without a browser, which is the point of
 * keeping the plan and the render apart: the windows, the durations, the
 * track scope and the paste block are facts about numbers and strings, and
 * a test with no audio context can hold them exactly.
 */
import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { songSupport } from "@/lib/acceptance/song-support";
import { buildTempoMap } from "@/lib/audio/tempo";
import { buildNotatedPlan } from "@/lib/audio/schedule";
import { auditClip, clipFault } from "@/lib/listening/clip-audit";
import { chordTake } from "@/lib/listening/chord-take";
import {
  listeningClips,
  takeSeconds,
  LISTENING_ANSWERS,
  RESTRIKE_ANSWERS,
} from "@/lib/listening/clip-plan";
import { formatListeningResult } from "@/lib/listening/listening-result";
import { gestureTakes } from "@/lib/listening/gesture-take";
import { sequenceTake } from "@/lib/listening/sequence-take";
import { inWindow } from "@/lib/playback/selection-playback";

const song = editorFixture();
const tempo = buildTempoMap(song);
const chord = chordTake(song, { rootPitchClass: 4, quality: "minor" });
const sequence = sequenceTake(song);
const clips = listeningClips(song, chord, sequence);
const clipOf = (id: string) => {
  const found = clips.find((entry) => entry.id === id);
  if (!found) throw new Error(`no clip ${id}`);
  return found;
};

describe("the pack the founder is handed", () => {
  it("asks ten questions and no more", () => {
    expect(clips.map((clip) => clip.id)).toEqual([
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
      "L6",
      "L7",
      "L8",
      /* 2V-B.3 adds exactly two — the loop return and the fast run — and the
         count is asserted here so that "exactly two" stays true the next time
         somebody has an idea. */
      "L9",
      "L10",
    ]);
  });

  it("always offers a way to say 'I could not tell', and no technical word", () => {
    for (const clip of clips) {
      /*
       * The real invariant, rather than a count: a listener who heard it and
       * could not tell has told us something, and a card with no way to say
       * that pushes them into a verdict they do not hold (2V-C.2 §15). L4
       * asks its question the other way round and has always had its own
       * three words, so the shape is checked and not the length.
       */
      expect(clip.answers).toContain("Emin değilim");
      expect(clip.answers.length).toBeGreaterThanOrEqual(3);
      expect(clip.question.length).toBeGreaterThan(0);
      for (const word of ["slot", "tick", "window", "trackId"]) {
        expect(clip.question.toLowerCase()).not.toContain(word);
        expect(clip.instruction.toLowerCase()).not.toContain(word);
        expect(clip.label.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("asks the pause question the way round it is actually answered", () => {
    /* Every other clip's "Olmuş" is good news. This one's is a defect, so it
       has its own wording rather than an inverted meaning on a shared word. */
    expect(clipOf("L4").answers).toEqual(RESTRIKE_ANSWERS);
    expect(clipOf("L1").answers).toEqual(LISTENING_ANSWERS);
  });
});

describe("what each clip actually contains", () => {
  it("keeps every take inside the length the clip promises", () => {
    for (const clip of clips) {
      for (const take of clip.takes) {
        const seconds = takeSeconds(take, tempo);
        expect(seconds, `${take.id}`).toBeGreaterThanOrEqual(clip.expects.minSeconds);
        expect(seconds, `${take.id}`).toBeLessThanOrEqual(clip.expects.maxSeconds);
      }
    }
  });

  it("gives L1 and L2 the same music and a different instrument list", () => {
    const one = clipOf("L1").takes[0]!.segments[0]!;
    const both = clipOf("L2").takes[0]!.segments[0]!;
    expect(one.window.startTicks).toBe(both.window.startTicks);
    expect(one.window.endTicks).toBe(both.window.endTicks);
    expect(one.window.trackIds.length).toBe(1);
    expect(both.window.trackIds.length).toBeGreaterThan(1);
  });

  it("puts a real second instrument in L2 and none in L1", () => {
    /* The A/B pair is only a pair if the B side has something the A side
       lacks. Read off the same plan the scheduler walks. */
    const events = buildNotatedPlan(song).events;
    const inOne = events.filter((event) =>
      inWindow(clipOf("L1").takes[0]!.segments[0]!.window, event),
    );
    const inBoth = events.filter((event) =>
      inWindow(clipOf("L2").takes[0]!.segments[0]!.window, event),
    );
    expect(inOne.length).toBeGreaterThan(0);
    expect(inBoth.length).toBeGreaterThan(inOne.length);
    expect(new Set(inOne.map((event) => event.trackId)).size).toBe(1);
    expect(new Set(inBoth.map((event) => event.trackId)).size).toBe(2);
  });

  it("starts L3's B side after an onset, on a note that is still sounding", () => {
    const a = clipOf("L3").takes[0]!.segments[0]!;
    const b = clipOf("L3").takes[1]!.segments[0]!;
    expect(b.window.startTicks).toBeGreaterThan(a.window.startTicks);
    expect(b.continueSustained).toBe(true);
    /* Something really is ringing there: an event that began earlier and has
       not finished. Otherwise B would be a shorter A, not a continuation. */
    const sustaining = buildNotatedPlan(song).events.filter(
      (event) =>
        event.kind === "note" &&
        event.trackId === b.window.trackIds[0] &&
        event.time < b.window.startTicks &&
        event.time + event.durationTicks > b.window.startTicks,
    );
    expect(sustaining.length).toBeGreaterThan(0);
  });

  it("gives L4's B side a boundary and continues across it", () => {
    const [first, second] = clipOf("L4").takes[1]!.segments;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.continueSustained).toBe(false);
    expect(second!.continueSustained).toBe(true);
    /* The join is exact: no gap, no overlap, no repeated tick. */
    expect(second!.window.startTicks).toBe(first!.window.endTicks);
  });

  it("puts L4's pause inside a note rather than on one", () => {
    /*
     * Measured, not assumed. The first version split on the vibrato's own
     * onset and both takes rendered byte-identically — at an onset the
     * transport fires the note itself, so the continuation had nothing to
     * carry and the clip asked its question about a silent boundary.
     */
    const pause = clipOf("L4").takes[1]!.segments[1]!.window.startTicks;
    const track = clipOf("L4").takes[1]!.segments[1]!.window.trackIds[0];
    const events = buildNotatedPlan(song).events.filter(
      (event) => event.kind === "note" && event.trackId === track,
    );
    const onsets = events.map((event) => event.time);
    expect(onsets).not.toContain(pause);
    const ringing = events.filter(
      (event) =>
        event.kind === "note" &&
        event.time < pause &&
        event.time + event.durationTicks > pause,
    );
    expect(ringing.length).toBeGreaterThan(0);
  });

  it("never asks a segment to sound a track the clip did not promise", () => {
    for (const clip of clips) {
      for (const take of clip.takes) {
        for (const segment of take.segments) {
          for (const trackId of segment.window.trackIds) {
            expect(clip.expects.trackIds, `${take.id}`).toContain(trackId);
          }
        }
      }
    }
  });

  it("keeps every window inside the song", () => {
    const total = buildNotatedPlan(song).events.reduce(
      (last, event) => Math.max(last, event.time + (event.kind === "note" ? event.durationTicks : 0)),
      0,
    );
    for (const clip of clips) {
      for (const take of clip.takes) {
        for (const segment of take.segments) {
          expect(segment.window.startTicks).toBeGreaterThanOrEqual(0);
          expect(segment.window.endTicks).toBeGreaterThan(segment.window.startTicks);
          expect(segment.window.startTicks).toBeLessThan(total + 768);
        }
      }
    }
  });

  it("has something to sound in every single-segment take", () => {
    const events = buildNotatedPlan(song).events;
    for (const clip of clips) {
      if (clip.id === "L8" || clip.id === "L10") continue;
      for (const take of clip.takes) {
        const heard = take.segments.some(
          (segment) =>
            events.some((event) => inWindow(segment.window, event)) ||
            segment.continueSustained,
        );
        expect(heard, `${take.id}`).toBe(true);
      }
    }
  });
});

describe("the chord take", () => {
  it("writes the recommended voicing with the production command", () => {
    expect(chord).not.toBeNull();
    expect(chord!.song).not.toBe(song);
    /* The chord landed: the first bar of the guitar now holds more notes than
       the power chord did. */
    const before = buildNotatedPlan(song).events.filter(
      (event) => event.trackId === "gtr" && event.time === 0,
    );
    const after = buildNotatedPlan(chord!.song).events.filter(
      (event) => event.trackId === "gtr" && event.time === 0,
    );
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(chord!.description.length).toBeGreaterThan(0);
  });

  it("leaves the source song untouched", () => {
    expect(JSON.stringify(song)).toBe(JSON.stringify(editorFixture()));
  });

  it("gives L8 both sides when a voicing exists", () => {
    expect(clipOf("L8").takes.map((take) => take.id)).toEqual(["L8a", "L8b"]);
  });

  it("offers the power chord alone when no chord could be built", () => {
    const alone = listeningClips(song, null);
    const l8 = alone.find((clip) => clip.id === "L8")!;
    expect(l8.takes.map((take) => take.id)).toEqual(["L8a"]);
    expect(l8.instruction).toContain("yalnız power chord");
  });
});

describe("what a rendered clip is measured for", () => {
  const seconds = (value: number, sampleRate = 44100) =>
    [new Float32Array(Math.round(value * sampleRate)), new Float32Array(Math.round(value * sampleRate))];

  const tone = (value: number, level: number) => {
    const channels = seconds(value);
    for (const channel of channels) {
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = Math.sin(index / 20) * level;
      }
    }
    return channels;
  };

  it("reports peak, rms and duration", () => {
    const audit = auditClip(tone(1, 0.5), 44100);
    expect(audit.seconds).toBeCloseTo(1, 2);
    expect(audit.peak).toBeGreaterThan(0.4);
    expect(audit.peak).toBeLessThanOrEqual(0.5);
    expect(audit.rms).toBeGreaterThan(0);
    expect(audit.silent).toBe(false);
    expect(audit.clipped).toBe(0);
    expect(audit.invalid).toBe(0);
  });

  it("calls an empty buffer silent", () => {
    const audit = auditClip(seconds(1), 44100);
    expect(audit.silent).toBe(true);
    expect(clipFault(audit, { minSeconds: 0, maxSeconds: 10 })).toBe("sessiz");
  });

  it("counts clipping and refuses the clip", () => {
    const audit = auditClip(tone(1, 1), 44100);
    expect(audit.clipped).toBeGreaterThan(0);
    expect(clipFault(audit, { minSeconds: 0, maxSeconds: 10 })).toBe("kırpılma");
  });

  it("refuses a buffer with an invalid sample", () => {
    const channels = tone(1, 0.5);
    channels[0]![10] = Number.NaN;
    const audit = auditClip(channels, 44100);
    expect(audit.invalid).toBe(1);
    expect(clipFault(audit, { minSeconds: 0, maxSeconds: 10 })).toBe("geçersiz örnek");
  });

  it("refuses a clip that is the wrong length", () => {
    const short = auditClip(tone(0.2, 0.5), 44100);
    expect(clipFault(short, { minSeconds: 1, maxSeconds: 10 })).toBe("çok kısa");
    const long = auditClip(tone(4, 0.5), 44100);
    expect(clipFault(long, { minSeconds: 0, maxSeconds: 2 })).toBe("çok uzun");
  });

  it("passes a clean clip", () => {
    expect(clipFault(auditClip(tone(2, 0.6), 44100), { minSeconds: 1, maxSeconds: 5 })).toBeNull();
  });
});

describe("the block the founder pastes back", () => {
  /*
   * The pack it is handed contains every card ever built, and no round is
   * open: L25 and L26 closed the slide phase and 2V-D.1 opened nothing. So
   * the block counts nothing as unanswered and prints the whole record
   * below, which is the difference between "nobody was asked" and "nobody
   * answered" (2V-C.2 §4; 2V-D.1 §19).
   */
  const round = listeningClips(song, chord, sequence, gestureTakes(song));
  const base = {
    buildSha: "abc1234",
    fingerprint: songSupport(song).fingerprint,
    clips: round,
    notes: {},
    note: "",
  };

  it("counts this round's cards, not every card that ever existed", () => {
    const block = formatListeningResult({ ...base, answers: {} });
    expect(block).toContain("Cevaplanmamış: 3/3");
    expect(block).toContain("Bu tur: 3 kart");
    /* The old summary counted the browser session's own answers against
       every card in the pack and reported the founder's decided results as
       unmeasured. Nothing here counts an archived card. */
    expect(block).not.toContain("/16");
    expect(block).not.toContain("/10");
  });

  it("never turns a blank or cleared answer into an approval", () => {
    /*
     * With the round closed there is nothing above the archive to approve,
     * and a session's own blank answers cannot put anything there. The
     * founder's recorded results are printed below, unchanged.
     */
    const block = formatListeningResult({
      ...base,
      answers: { L25: "", L26: null },
    });
    const asked = block.slice(0, block.indexOf("Önceki turlar"));
    expect(asked).not.toContain("Olmuş");
    expect(block).toContain("L25 Tek telli vurarak slide: Olmuş");
    expect(block).toContain("L26 İki telli şekil slide'ı: Olmuş");
  });

  it("says so when a comment was written but no verdict chosen", () => {
    /* Two different things: nobody touched it, and somebody wrote something
       down and did not commit to a word. Neither is a pass. */
    const block = formatListeningResult({
      ...base,
      answers: {},
      notes: { L27: "biraz mekanik" },
    });
    /* A note on an archived card is a session's scribble, not a verdict: the
       record keeps saying what the founder said. */
    expect(block).toContain("L25 Tek telli vurarak slide: Olmuş");
    /* The comment does not count as an answer for this round's own card. */
    expect(block).toContain("Cevaplanmamış: 3/3");
    /* This round only. The archive below legitimately says "Olmuş" about
       cards the founder passed, and that is a record, not an answer. */
    expect(block.slice(0, block.indexOf("Önceki turlar"))).not.toContain("Olmuş");
  });

  it("carries the answers and per-clip notes it was given", () => {
    const block = formatListeningResult({
      ...base,
      answers: { L27: "Kısmen", L28: "Olmamış", L25: "Olmuş" },
      notes: { L28: "kulaklıkta daha net" },
    });
    /* This round's own answers reach the block, with their notes. */
    expect(block).toContain("L27 Avuç susturma: iki yazım: Kısmen");
    expect(block).toContain("L28 Armonik ve perde hareketi: Olmamış");
    expect(block).toContain("kulaklıkta daha net");
    /* One card left blank, and the count says so rather than rounding up. */
    expect(block).toContain("Cevaplanmamış: 1/3");
    /*
     * The strongest form of "the record is the founder's": a session that
     * answers a closed card cannot change what it says. The archived row
     * still reads the way the founder left it.
     */
    expect(block).toContain("L26 İki telli şekil slide'ı: Olmuş");
  });

  it("uses each card's own title, never its id twice", () => {
    /* "L11 L11" is what a second table of short names produced for every
       card it had no row for. There is one title now, and it is the clip's. */
    const block = formatListeningResult({ ...base, answers: {} });
    for (const clip of round) {
      expect(block).not.toContain(`${clip.id} ${clip.id}`);
    }
    expect(block).toMatch(/L26 İki telli şekil slide.ı:/u);
  });

  it("prints the recorded results without letting a session change them", () => {
    const block = formatListeningResult({ ...base, answers: {} });
    expect(block).toContain("Önceki turlar (kayıtlı):");
    expect(block).toContain("L11 Bend: tut / geri indir: Cila gerekiyor");
    expect(block).toContain("L12 Önceden bükme: tut / geri indir: Ölçülmedi");
    expect(block).toContain("L15 Bend + tepede vibrato: Olmuş");
    /* An archived row says what the founder said, whatever this session did. */
    const answered = formatListeningResult({
      ...base,
      answers: { L11: "Olmamış" },
    });
    expect(answered).toContain("L11 Bend: tut / geri indir: Cila gerekiyor");
  });

  it("names the build and the music without asking anyone to check them", () => {
    const block = formatListeningResult({ ...base, answers: {} });
    expect(block.startsWith("Build: abc1234")).toBe(true);
    expect(block).toContain(`Parça: ${base.fingerprint}`);
  });

  it("keeps this round's own section short enough to read at a glance", () => {
    const block = formatListeningResult({
      ...base,
      answers: Object.fromEntries(round.map((clip) => [clip.id, "Olmuş"])),
      note: "genel olarak iyi",
    });
    const thisRound = block.slice(0, block.indexOf("Önceki turlar"));
    expect(thisRound.split("\n").length).toBeLessThanOrEqual(12);
  });
});
