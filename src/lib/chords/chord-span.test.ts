/**
 * How long a chord lasts, said the way a player says it (2V-B.4 §14).
 *
 * There is no duration field when a chord is added. The four options are the
 * four answers a player would actually give, and each of them is a number
 * this module works out — so the reader chooses an intention and the app does
 * the arithmetic, rather than the other way round.
 */
import { describe, expect, it } from "vitest";

import {
  CHORD_SPAN_IDS,
  CHORD_SPAN_LABEL,
  chordSpanOffers,
  defaultChordSpan,
} from "@/lib/chords/chord-span";

/** A chord on beat two of a 4/4 bar, with another event on beat four. */
const CONTEXT = {
  startTicks: 192,
  beatTicks: 192,
  measureEndTicks: 768,
  nextOnsetTicks: 576,
  selectionEndTicks: null,
};

describe("57. a chord's length is an intention, not a number", () => {
  it("offers the four the batch names, always all four", () => {
    expect([...CHORD_SPAN_IDS]).toEqual([
      "this_beat",
      "to_measure_end",
      "to_next_chord",
      "selection",
    ]);
    expect(CHORD_SPAN_IDS.map((id) => CHORD_SPAN_LABEL[id])).toEqual([
      "Bu vuruş",
      "Ölçü sonuna kadar",
      "Sonraki akora kadar",
      "Seçili alan boyunca",
    ]);
    expect(chordSpanOffers(CONTEXT).map((offer) => offer.id)).toEqual([...CHORD_SPAN_IDS]);
  });

  it("works each length out from where the chord actually is", () => {
    const offers = chordSpanOffers(CONTEXT);
    const at = (id: string) => offers.find((offer) => offer.id === id)!;
    expect(at("this_beat").ticks).toBe(192);
    expect(at("to_measure_end").ticks).toBe(576);
    expect(at("to_next_chord").ticks).toBe(384);
  });

  it("greys the ones that cannot apply, with a reason a player understands", () => {
    const offers = chordSpanOffers(CONTEXT);
    const selection = offers.find((offer) => offer.id === "selection")!;
    expect(selection.state).toBe("disabled");
    expect(selection.reason).toBe("Şu an seçili bir alan yok.");
    expect(selection.reason).not.toMatch(/tick|slot/iu);

    const atEnd = chordSpanOffers({ ...CONTEXT, startTicks: 768, nextOnsetTicks: null });
    expect(atEnd.find((offer) => offer.id === "this_beat")?.state).toBe("disabled");
    expect(atEnd.find((offer) => offer.id === "to_measure_end")?.state).toBe("disabled");
    expect(atEnd.find((offer) => offer.id === "to_next_chord")?.reason).toBe(
      "Bundan sonra başka bir olay yok.",
    );
  });

  it("never lets a chord run past the measure it was written into", () => {
    const late = chordSpanOffers({ ...CONTEXT, startTicks: 672 });
    expect(late.find((offer) => offer.id === "this_beat")?.ticks).toBe(96);
    expect(late.find((offer) => offer.id === "to_measure_end")?.ticks).toBe(96);
  });

  it("starts on the reader's own selection when they made one", () => {
    expect(defaultChordSpan(CONTEXT)).toBe("this_beat");
    expect(defaultChordSpan({ ...CONTEXT, selectionEndTicks: 576 })).toBe("selection");
    /* A selection that ends before the chord begins is not a selection of it. */
    expect(defaultChordSpan({ ...CONTEXT, selectionEndTicks: 96 })).toBe("this_beat");
  });

  it("uses the held range's length when it is the choice", () => {
    const offers = chordSpanOffers({ ...CONTEXT, selectionEndTicks: 576 });
    const selection = offers.find((offer) => offer.id === "selection")!;
    expect(selection.state).toBe("available");
    expect(selection.ticks).toBe(384);
  });
});
