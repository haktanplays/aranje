import { describe, expect, it } from "vitest";

import {
  countingDescription,
  gridLine,
  meterLine,
  tempoLine,
} from "@/lib/music/counting-language";
import type { Resolution } from "@/lib/song/schema";

describe("three questions, three sentences", () => {
  it("names the bar's shape", () => {
    expect(meterLine([4, 4])).toMatchObject({
      text: "Ölçü: 4/4",
      helper: "Her ölçüde 4 dörtlük",
    });
    expect(meterLine([6, 8]).helper).toBe("Her ölçüde 6 sekizlik");
  });

  it("names the speed", () => {
    expect(tempoLine(132).text).toBe("Tempo: 132 BPM");
  });

  it("names the writing grid and how many steps a beat has", () => {
    expect(gridLine([4, 4], 16)).toMatchObject({
      text: "Izgara: 16'lık",
      helper: "Her vuruşta 4 adım",
      technical: "1/16",
    });
  });

  it("says a triplet beat is divided into equal steps", () => {
    const line = gridLine([4, 4], 12);
    expect(line.text).toBe("Izgara: Sekizlik triole");
    expect(line.helper).toBe("Her vuruşta 3 eşit adım");
  });

  it("says a thirty-second beat has eight steps", () => {
    expect(gridLine([4, 4], 32)).toMatchObject({
      text: "Izgara: 32'lik",
      helper: "Her vuruşta 8 adım",
    });
  });

  /*
   * The founder's complaint, as an assertion: no line may be a bare number,
   * and no line may borrow another's label.
   */
  it("never shows a number without saying what it answers", () => {
    for (const line of [meterLine([4, 4]), tempoLine(132), gridLine([4, 4], 16)]) {
      expect(line.text).toMatch(/^(Ölçü|Tempo|Izgara): /);
    }
  });

  it("keeps the technical name available without leading with it", () => {
    for (const resolution of [4, 8, 12, 16, 24, 32] as Resolution[]) {
      const line = gridLine([4, 4], resolution);
      expect(line.technical.startsWith("1/")).toBe(true);
      expect(line.text.includes(line.technical)).toBe(false);
    }
  });

  it("reads all three out once, in order", () => {
    const said = countingDescription([4, 4], 132, 16);
    expect(said).toBe(
      "Ölçü: 4/4 — Her ölçüde 4 dörtlük. Tempo: 132 BPM — Dakikadaki vuruş sayısı. " +
        "Izgara: 16'lık — Her vuruşta 4 adım",
    );
  });
});
