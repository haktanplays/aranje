/**
 * What the machine can check about L30–L32 (2V-D.2 c3 §12–§14).
 *
 * The line these tests hold is the one the whole listening pack rests on:
 * they prove the difference is **rendered**, and they cannot and do not say
 * it is *heard*. "The two takes are different bytes at the right ticks" is a
 * fact about the plan. "The 7/8 sounds grouped" is the founder's to say, and
 * nothing here may award it.
 */
import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { barTimeline } from "@/lib/audio/schedule";
import { listeningClips } from "@/lib/listening/clip-plan";
import { buildRhythmTakes, RHYTHM_TAKE_IDS } from "@/lib/listening/rhythm-take";
import { ACTIVE_CLIP_IDS } from "@/lib/listening/listening-scope";
import { meterBeats } from "@/lib/music/meter-beats";
import { PPQ } from "@/lib/music/timing";

const fixture = editorFixture();
const takes = buildRhythmTakes(fixture);
if (!takes) throw new Error("rhythm takes did not build");

/** The bars this take listens to, from the production timeline. */
const listenedBars = (id: (typeof RHYTHM_TAKE_IDS)[number]) => {
  const take = takes[id];
  return barTimeline(take.song).slice(
    take.barNumber - 1,
    take.barNumber - 1 + take.barCount,
  );
};

/** Every onset the production planner puts in those bars, in order. */
const onsets = (id: (typeof RHYTHM_TAKE_IDS)[number]) => {
  const take = takes[id];
  const bars = listenedBars(id);
  const from = bars[0]!.time;
  const to = bars[bars.length - 1]!.time + bars[bars.length - 1]!.durationTicks;
  return buildExpressionPlan(take.song)
    .notes.filter(
      (note) =>
        note.trackId === take.trackId && note.timeTicks >= from && note.timeTicks < to,
    )
    .sort((left, right) => left.timeTicks - right.timeTicks);
};

/**
 * What the *song* says about the listened bars, read from the notes.
 *
 * The plan is where the levels are; this is where the writing is, and the
 * L33 assertions are about the writing — one pitch, one duration, and an
 * authored striking on every eighth.
 */
const notesOf = (id: (typeof RHYTHM_TAKE_IDS)[number]) => {
  const take = takes[id];
  const bars = listenedBars(id);
  const out: {
    slot: number;
    pitch: string;
    durationTicks: number;
    attack?: string;
  }[] = [];
  let index = 0;
  for (const marker of bars) {
    const [sectionId, barIndex] = marker.barKey.split(":");
    const bar = take.song.sections
      .find((section) => section.id === sectionId)
      ?.bars[Number(barIndex)];
    const lane = bar?.slots[take.trackId];
    if (!lane) continue;
    lane.forEach((slot, position) => {
      if (!slot || slot === "-" || Array.isArray(slot)) return;
      const note = slot.notes[0];
      if (!note) return;
      out.push({
        slot: index * 7 + position,
        pitch: note.pitch,
        durationTicks: PPQ / 2,
        ...(note.attack === undefined ? {} : { attack: note.attack }),
      });
    });
    index += 1;
  }
  return out;
};

describe("376. L30 — a real 6/8 with a fast run inside it", () => {
  it("is a 6/8 bar felt in two, on a lattice that writes both divisions", () => {
    const [bar] = listenedBars("L30a");
    expect(bar?.timeSignature).toEqual([6, 8]);
    expect(bar?.durationTicks).toBe(576);
    expect(
      meterBeats({ meter: [6, 8], resolution: 48, grouping: [3, 3] }).map(
        (beat) => beat.slot * 16,
      ),
    ).toEqual([0, 288]);
  });

  it("puts the straight eighths and the triplets on exact ticks", () => {
    /*
     * The measurement c1 made, now carried by a real bar: straight eighths
     * every 96 ticks in the first main beat, sixteenth triplets every 32 in
     * the second. Nothing is rounded, and no tick is fractional.
     */
    const ticks = onsets("L30a").map((note) => note.timeTicks - listenedBars("L30a")[0]!.time);
    expect(ticks.slice(0, 3)).toEqual([0, 96, 192]);
    const run = ticks.slice(3);
    expect(run).toHaveLength(9);
    expect(run).toEqual([288, 320, 352, 384, 416, 448, 480, 512, 544]);
    for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
  });

  it("closes the bar exactly, so a second loop starts where the first ended", () => {
    /*
     * The *onset* grid is what has to be exact, and it is: the last note
     * starts on the last lattice step of the bar. Its sounding end is a few
     * ticks short of the line because the planner gates every note slightly,
     * which is a deliberate articulation choice and not a drift — so the
     * assertion is that nothing runs past the line and nothing stops a
     * subdivision early.
     */
    const [bar] = listenedBars("L30a");
    const line = bar!.time + bar!.durationTicks;
    const last = onsets("L30a").at(-1)!;
    expect(last.timeTicks).toBe(bar!.time + 544);
    const end = last.timeTicks + last.durationTicks;
    expect(end).toBeLessThanOrEqual(line);
    expect(line - end).toBeLessThan(32);
  });

  it("plays the same bar twice, so a drift would arrive as a late loop", () => {
    const clip = listeningClips(fixture, null, null, null, takes).find(
      (entry) => entry.id === "L30",
    );
    expect(clip?.takes[0]?.segments).toHaveLength(2);
    const [first, second] = clip!.takes[0]!.segments;
    expect(first?.window).toEqual(second?.window);
  });
});

describe("377. L31 — the same riff, grouped two ways", () => {
  it("keeps everything except the accents identical", () => {
    /*
     * The card's whole claim. If the pitches, the ticks, the durations or the
     * bar length differed, the founder would be comparing two riffs rather
     * than two *groupings* of one.
     */
    const a = onsets("L31a");
    const b = onsets("L31b");
    expect(a.map((note) => note.pitch)).toEqual(b.map((note) => note.pitch));
    expect(a.map((note) => note.durationTicks)).toEqual(
      b.map((note) => note.durationTicks),
    );
    expect(listenedBars("L31a")[0]?.durationTicks).toBe(
      listenedBars("L31b")[0]?.durationTicks,
    );
    expect(takes.L31a.song.bpm).toBe(takes.L31b.song.bpm);
    expect(takes.L31a.trackId).toBe(takes.L31b.trackId);
    expect(a).toHaveLength(7);
    expect(b).toHaveLength(7);
  });

  it("accents the group starts, and they differ between the takes", () => {
    /*
     * The accent lands on the gain **envelope**, not on `gain` — the plan
     * documents that field as the value *before* articulation shaping, so
     * reading it would have found nothing and reported no difference. The
     * envelope is what the voice is actually driven with.
     */
    const eighth = PPQ / 2;
    const peak = (points: readonly { value: number }[]) =>
      Math.max(...points.map((point) => point.value));
    const loudest = (id: "L31a" | "L31b") =>
      Math.max(...onsets(id).map((note) => peak(note.gainEnvelope)));
    const accented = (id: "L31a" | "L31b") => {
      const from = listenedBars(id)[0]!.time;
      const top = loudest(id);
      return onsets(id)
        .filter((note) => peak(note.gainEnvelope) === top)
        .map((note) => (note.timeTicks - from) / eighth);
    };
    /* 2+2+3 accents eighths 1, 3 and 5; 3+2+2 accents 1, 4 and 6. */
    expect(accented("L31a")).toEqual([0, 2, 4]);
    expect(accented("L31b")).toEqual([0, 3, 5]);
  });

  it("makes the difference audible without a single click", () => {
    /*
     * §13 and c2's guardrail: the two takes must differ in the *music*. The
     * gains differ note by note, which is a real difference in what the
     * speakers are asked to do — and there is no metronome in a clip's plan
     * at all, so nothing here could be leaning on one.
     */
    const shape = (id: "L31a" | "L31b") =>
      onsets(id).map((note) => Math.max(...note.gainEnvelope.map((point) => point.value)));
    const a = shape("L31a");
    const b = shape("L31b");
    expect(a).not.toEqual(b);
    /* And the accents are a real difference in level, not a relabelling. */
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(Math.max(...a)).toBeGreaterThan(Math.min(...a));

    const clip = listeningClips(fixture, null, null, null, takes).find(
      (entry) => entry.id === "L31",
    );
    expect(clip?.takes.map((take) => take.id)).toEqual(["L31a", "L31b"]);
    expect(clip?.instruction).toContain("Metronom yok");
  });
});

describe("378. L32 — one riff across a metre change", () => {
  it("listens to two bars in different metres", () => {
    const bars = listenedBars("L32a");
    expect(bars.map((bar) => `${bar.timeSignature[0]}/${bar.timeSignature[1]}`)).toEqual([
      "7/8",
      "6/8",
    ]);
    expect(bars[0]?.durationTicks).toBe(672);
    expect(bars[1]?.durationTicks).toBe(576);
  });

  it("starts the second bar exactly where the first ends", () => {
    const [first, second] = listenedBars("L32a");
    expect(second?.time).toBe(first!.time + first!.durationTicks);
  });

  it("carries a sounding note up to the bar line and strikes the next", () => {
    /*
     * What the founder is actually listening to: a held sound reaching the
     * line, then a real attack on the other side of it. A rest there would
     * make the card a question about silence, and a second copy of the same
     * note would make it a question about a duplicate.
     */
    const bars = listenedBars("L32a");
    const line = bars[1]!.time;
    const notes = onsets("L32a");
    /* Gated a few ticks short of the line, like every other note: what makes
       it a crossing is that it is still sounding at the end of its bar rather
       than having stopped somewhere inside it. */
    const crossing = notes.filter(
      (note) =>
        note.timeTicks < line && note.timeTicks + note.durationTicks > line - 32,
    );
    expect(crossing.length).toBeGreaterThan(0);
    const after = notes.filter((note) => note.timeTicks === line);
    expect(after).toHaveLength(1);
  });

  it("is named for what is heard, not for the metadata behind it", () => {
    const clip = listeningClips(fixture, null, null, null, takes).find(
      (entry) => entry.id === "L32",
    );
    expect(clip?.label).toBe("Farklı ölçüler arasında riff devamı");
    expect(clip?.question).toBe(
      "Riff ölçü çizgisinde kopmadan tek bir müzikal cümle gibi devam ediyor mu?",
    );
    /* "Phrase metadata is audible" would be a false claim; the card never
       makes it. */
    for (const text of [clip?.label, clip?.question, clip?.instruction]) {
      expect(text).not.toMatch(/phrase|metadata|cümle verisi/i);
    }
  });
});

describe("390. L34 — the same note struck three ways", () => {
  it("changes nothing but the striking", () => {
    /* One pitch, one register, one duration: if any of these moved, the card
       would be asking about two things and the founder could not answer it. */
    const written = notesOf("L34a");
    expect(written).toHaveLength(6);
    expect(new Set(written.map((note) => note.pitch)).size).toBe(1);
    expect(new Set(written.map((note) => note.durationTicks)).size).toBe(1);
  });

  it("writes plain, accent and ghost in that order, twice", () => {
    const written = notesOf("L34a");
    expect(written.map((note) => note.attack ?? "plain")).toEqual([
      "plain",
      "accent",
      "ghost",
      "plain",
      "accent",
      "ghost",
    ]);
  });

  it("leaves a real gap between the two groups", () => {
    /* Three notes running into each other are a phrase; three with a rest
       after them are a comparison. An eighth is 96 ticks, so the gap between
       the ghost and the next plain note has to be twice that. */
    const times = onsets("L34a").map((note) => note.timeTicks);
    expect(times).toHaveLength(6);
    const gaps = times.slice(1).map((time, index) => time - times[index]!);
    expect(gaps).toEqual([96, 96, 192, 96, 96]);
  });

  it("makes the ordering a fact about the plan, not about the card", () => {
    /* The card cannot boost itself: what it plays is what the presets say,
       and this reads the three levels off the production planner. */
    const [firstPlain, accent, ghost] = onsets("L34a");
    const peak = (note: (typeof onsets extends never ? never : ReturnType<typeof onsets>)[number]) =>
      note.gainEnvelope.length === 0
        ? note.gain
        : Math.max(...note.gainEnvelope.map((point) => point.value));
    expect(firstPlain && accent && ghost).toBeTruthy();
    if (!firstPlain || !accent || !ghost) return;
    expect(peak(accent)).toBeGreaterThan(peak(firstPlain));
    expect(peak(firstPlain)).toBeGreaterThan(peak(ghost));
    /* And the same gain underneath all three — no per-card level. */
    expect(new Set(onsets("L34a").map((note) => note.gain)).size).toBe(1);
  });

  it("asks the founder about loudness in words, and shows no number", () => {
    const clip = listeningClips(fixture, null, null, null, takes).find(
      (entry) => entry.id === "L34",
    );
    expect(clip?.question).toBe(
      "Vurgulu nota düz notadan daha belirgin, hayalet nota ise daha geride ve doğal duyuluyor mu?",
    );
    expect(`${clip?.instruction} ${clip?.question}`).not.toMatch(
      /dB|tick|gain|accent|ghost|velocity/i,
    );
  });
});

describe("391. L35 — one phrase that picks expression up and puts it down", () => {
  it("keeps the plain notes as a control on both sides of the expression", () => {
    const notes = onsets("L35a");
    expect(notes.length).toBeGreaterThanOrEqual(6);
    const plain = notes.filter((note) => !note.expressive);
    expect(plain.length).toBeGreaterThanOrEqual(3);
    /* The first and the last note of the phrase are both plain: whatever
       happens in the middle has to come back to them. */
    expect(notes[0]?.expressive).toBe(false);
    expect(notes[notes.length - 1]?.expressive).toBe(false);
  });

  it("really contains a vibrato, a bend and its release, and a slide", () => {
    /* Non-vacuous: a card whose techniques quietly fell out on the way to the
       plan would be a phrase of plain notes asking about expression. */
    const notes = onsets("L35a");
    const vibrato = notes.find((note) => note.pitchAutomation.length > 20);
    expect(vibrato, "no vibrato reached the plan").toBeDefined();
    const bend = notes.find(
      (note) =>
        note.pitchAutomation.some((point) => point.cents >= 199) &&
        (note.pitchAutomation[note.pitchAutomation.length - 1]?.cents ?? 0) < 1,
    );
    expect(bend, "no bend release reached the plan").toBeDefined();
    const slide = notes.find(
      (note) =>
        note.pitchAutomation.some((point) => point.cents >= 199) && note !== bend,
    );
    expect(slide, "no slide reached the plan").toBeDefined();
  });

  it("writes no attack anywhere, so nothing in it is a level change", () => {
    /* The card is about whether expression stays level. An accent inside it
       would be a level change the founder was not asked about. */
    for (const note of notesOf("L35a")) expect(note.attack).toBeUndefined();
  });

  it("stays on one string and in one register", () => {
    const strings = new Set(
      onsets("L35a").map((note) => note.position?.stringIndex),
    );
    expect(strings.size).toBe(1);
    const frets = onsets("L35a").map((note) => note.position?.fret ?? 0);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(2);
  });

  it("asks about level and character together, without a number", () => {
    const clip = listeningClips(fixture, null, null, null, takes).find(
      (entry) => entry.id === "L35",
    );
    expect(clip?.question).toBe(
      "Bend, vibrato ve kaydırma geldiğinde karakter değişiyor ama ses seviyesi aniden zıplamadan aynı cümlenin içinde kalıyor mu?",
    );
    expect(`${clip?.instruction} ${clip?.question}`).not.toMatch(
      /dB|tick|gain|cents|expressive/i,
    );
  });
});

describe("379. the round asks three questions and awards none", () => {
  it("offers every rhythm card and asks none of them", () => {
    /*
     * The three from the rhythm round still exist as clips — they are the
     * music the archive's rows are about — but they are not being asked.
     * Which cards exist and which are being asked are different questions
     * and this holds them apart.
     */
    const clips = listeningClips(fixture, null, null, null, takes);
    const rhythm = clips.filter((clip) =>
      ["L30", "L31", "L32", "L33", "L34", "L35"].includes(clip.id),
    );
    expect(rhythm.map((clip) => clip.id)).toEqual([
      "L30",
      "L31",
      "L32",
      "L33",
      "L34",
      "L35",
    ]);
    expect([...ACTIVE_CLIP_IDS]).toEqual([]);
  });

  it("gives L33 one pitch, so nothing but the striking can group it", () => {
    /*
     * L31's riff ran 5-6-7-5-6-7-5, a contour that repeats every three notes
     * and proposes a grouping of its own — one that agrees with neither
     * `2+2+3` nor `3+2+2`. With a single repeated note there is nothing left
     * to group by except where the accents fall.
     */
    for (const id of ["L33a", "L33b"] as const) {
      const notes = notesOf(id);
      expect(notes).toHaveLength(14);
      expect(new Set(notes.map((note) => note.pitch)).size).toBe(1);
      expect(new Set(notes.map((note) => note.durationTicks)).size).toBe(1);
    }
  });

  it("authors every L33 eighth, so the quiet ones are still a pulse", () => {
    /*
     * The measured defect L31 exposed is that an attacked note and a bare one
     * are not delivered at the levels the presets declare. Writing `ghost` on
     * the unaccented eighths keeps every note on one side of that difference,
     * so what a listener compares is `accent` against `ghost` — a ratio the
     * presets own — rather than "attacked" against "bare".
     */
    for (const id of ["L33a", "L33b"] as const) {
      const attacks = notesOf(id).map((note) => note.attack);
      expect(attacks.filter((attack) => attack === "accent")).toHaveLength(6);
      expect(attacks.filter((attack) => attack === "ghost")).toHaveLength(8);
      expect(attacks.filter((attack) => attack === undefined)).toHaveLength(0);
    }
  });

  it("moves only the accents between the two L33 takes", () => {
    const a = notesOf("L33a");
    const b = notesOf("L33b");
    expect(a.map((note) => note.pitch)).toEqual(b.map((note) => note.pitch));
    expect(a.map((note) => note.slot)).toEqual(b.map((note) => note.slot));
    expect(a.map((note) => note.durationTicks)).toEqual(
      b.map((note) => note.durationTicks),
    );
    /* Eighths 0, 2, 4 against 0, 3, 5 — the two feels, in one bar each. */
    const accentsIn = (notes: readonly { slot: number; attack?: string }[]) =>
      notes.filter((note) => note.attack === "accent").map((note) => note.slot % 7);
    expect(accentsIn(a)).toEqual([0, 2, 4, 0, 2, 4]);
    expect(accentsIn(b)).toEqual([0, 3, 5, 0, 3, 5]);
  });

  it("plays each L33 bar twice and schedules no click", () => {
    for (const id of ["L33a", "L33b"] as const) {
      expect(takes[id].barCount).toBe(2);
      expect(takes[id].ticks).toBe(2 * 7 * (PPQ / 2));
      /* Counted in the song rather than in the list of specs the take was
         asked for: a take that promised two bars and appended one would
         otherwise report two and play one. */
      const bars = listenedBars(id);
      expect(bars).toHaveLength(2);
      for (const bar of bars) expect(bar.timeSignature).toEqual([7, 8]);
      expect(notesOf(id)).toHaveLength(14);
    }
    const clip = listeningClips(fixture, null, null, null, takes).find(
      (entry) => entry.id === "L33",
    );
    expect(clip?.takes.map((take) => take.id)).toEqual(["L33a", "L33b"]);
    expect(clip?.instruction).toContain("Metronom yok");
    expect(clip?.question).toBe(
      "Bu kez iki tekrar belirgin biçimde farklı yerlerden gruplanmış gibi duyuluyor mu?",
    );
  });

  it("builds no card when the takes could not be built", () => {
    /* A missing fixture must remove the card, never leave one pointing at
       music that is not there. */
    const without = listeningClips(fixture, null, null, null, null).map((clip) => clip.id);
    expect(without).not.toContain("L30");
    expect(without).not.toContain("L31");
    expect(without).not.toContain("L32");
    expect(without).not.toContain("L33");
  });

  it("asks the founder to listen and never to edit", () => {
    const clips = listeningClips(fixture, null, null, null, takes).filter((clip) =>
      ["L30", "L31", "L32", "L33"].includes(clip.id),
    );
    for (const clip of clips) {
      for (const text of [clip.instruction, clip.question]) {
        expect(text, clip.id).not.toMatch(/seç|tıkla|bas |sürükle|düzenle|aç /i);
      }
    }
  });
});
