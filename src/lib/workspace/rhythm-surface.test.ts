/**
 * One rhythm vocabulary on one screen (2V-D.2 §17).
 *
 * The failure this prevents is not a bug in the usual sense: every control
 * works, and the reader still cannot tell what they are looking at, because
 * "Ritim", "Aralık", "Çözünürlük" and "Slot" are four words for two things.
 * So these tests read the shipped panel source and the shipped panel table
 * and hold them to the six names the vocabulary actually has.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { RHYTHM_CONCEPTS, conceptLabel } from "@/lib/music/rhythm-vocabulary";
import {
  SHELF_PANELS,
  SHELF_PANEL_IDS,
  panelEntries,
} from "@/lib/workspace/shelf-panel";

const METER_PANEL = readFileSync(
  "src/components/workspace/shelf/MeterPanel.tsx",
  "utf8",
);

/**
 * The panel with its prose removed.
 *
 * The header explains at length what the panel does *not* show — "no PPQ, no
 * resolution, no slot count" — so a grep for those words over the whole file
 * finds the promise and reports it as the breach. What is on trial is the
 * code, so the comments come out first.
 */
const METER_CODE = METER_PANEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  "",
);

describe("384. the click's own row, and the label that is spelled one way", () => {
  it("offers the click settings in Pro and nowhere else", () => {
    /*
     * Behind **Daha fazla**, with the rest of Pro: how closely to count is a
     * rehearsal decision about a bar you already know is uneven, not one of
     * the five sentences Simple asks. The row is inside the `pro` branch, so
     * a beginner never meets it (completion §8).
     */
    expect(METER_CODE).toContain('<ShelfRow label="Metronom" testId="meter-click">');
    const proBranch = METER_CODE.slice(METER_CODE.indexOf("{pro ? ("));
    expect(proBranch).toContain('testId="meter-click"');
  });

  it("changes only the listener's setting, never the bar", () => {
    /*
     * The one thing this control may not do. `onDetail` is the session
     * preference's own setter; a press that reached `onDraft` would be a
     * click setting writing a metre.
     */
    expect(METER_CODE).toContain("onPress={() => click.onDetail(detail)}");
    const row = METER_CODE.slice(
      METER_CODE.indexOf('testId="meter-click"'),
      METER_CODE.indexOf("clickNote ?"),
    );
    expect(row).not.toContain("onDraft");
    expect(row).not.toContain("onApply");
  });

  it("never writes the note-length label as anything but Nota süresi", () => {
    /*
     * A typo in a label is not a small thing: it is the app spelling a note
     * wrong at the reader, in the one place the vocabulary is supposed to be
     * exact. Checked across the shipped source rather than in one file,
     * because the string lives in a table, a mark and a component (§13).
     */
    for (const path of [
      "src/lib/workspace/shelf-panel.ts",
      "src/lib/tab/rhythm-marks.ts",
      "src/components/workspace/EditorDock.tsx",
      "src/components/workspace/DurationControl.tsx",
    ]) {
      expect(readFileSync(path, "utf8"), path).not.toContain("Nato");
    }
    expect(SHELF_PANELS.duration.label).toBe("Nota süresi");
  });
});

describe("370. the rhythm panels speak one language", () => {
  it("names the metre panel and the duration panel from the vocabulary", () => {
    /* "Ölçü" and "Nota süresi" are the vocabulary's own words. The duration
       panel used to be called "Süre", which is the same word the chord panel
       uses for how long a chord lasts — two panels, one name. */
    expect(SHELF_PANELS.meter.label).toBe(conceptLabel("meter"));
    expect(SHELF_PANELS.duration.label).toBe(conceptLabel("duration"));
  });

  it("asks the ring question where a beginner meets it", () => {
    expect(SHELF_PANELS.duration.hint).toBe("Ne kadar çınlasın?");
  });

  it("shows no competing name for a grid on the metre panel", () => {
    /*
     * The four banned words, greped out of the shipped component. "Grid" is
     * the vocabulary's own word for the thing and appears through
     * `conceptLabel`, so the panel never spells one itself.
     */
    for (const banned of ["Çözünürlük", "Aralık", "Slot", "Ritim ayarı"]) {
      expect(METER_CODE, banned).not.toContain(banned);
    }
  });

  it("puts the Pro controls behind one door called Daha fazla", () => {
    expect(METER_CODE).toContain('label="Daha fazla"');
    /* And that door is a region of the panel, not a second screen: nothing
       in it can cover the grid (§17). */
    expect(METER_CODE).not.toContain("fixed inset-0");
    expect(METER_CODE).not.toContain('role="dialog"');
  });

  it("keeps every concept's label unique across the whole dock", () => {
    /* A panel sharing a name with a concept it is not about is the same
       confusion in a different place. */
    const panelLabels = SHELF_PANEL_IDS.map((id) => SHELF_PANELS[id].label);
    expect(new Set(panelLabels).size).toBe(panelLabels.length);
    for (const concept of RHYTHM_CONCEPTS) {
      const matching = panelLabels.filter((label) => label === concept.label);
      expect(matching.length, concept.id).toBeLessThanOrEqual(1);
    }
  });
});

describe("371. the metre is a question about a bar, not about a note", () => {
  it("opens without anything selected", () => {
    /*
     * Every other panel needs a target because every other panel is about a
     * note. A reader looking at a bar can always ask what it is written in,
     * and refusing until they tap something would be asking them to select
     * something to answer a question that is not about it.
     */
    const nothing = panelEntries({
      hasCell: false,
      hasSelection: false,
      fretted: true,
      canEdit: true,
    });
    const meter = nothing.find((entry) => entry.id === "meter");
    expect(meter?.reason).toBeUndefined();
  });

  it("is still refused, with a reason, when the song cannot be edited", () => {
    const locked = panelEntries({
      hasCell: true,
      hasSelection: true,
      fretted: true,
      canEdit: false,
    });
    for (const entry of locked) {
      expect(entry.reason, entry.id).toBeTruthy();
    }
  });

  it("lists every panel every time, greyed rather than gone", () => {
    for (const context of [
      { hasCell: false, hasSelection: false, fretted: false, canEdit: false },
      { hasCell: true, hasSelection: true, fretted: true, canEdit: true },
    ]) {
      expect(panelEntries(context).map((entry) => entry.id)).toEqual([
        ...SHELF_PANEL_IDS,
      ]);
    }
  });
});

describe("372. the panel reads the authorities and computes nothing", () => {
  it("asks the preview rather than deciding whether a change fits", () => {
    /* §14 and c2's guardrail 1: the panel shows what `previewMeterChange`
       said. A component comparing tick counts itself would be a second
       answer to a question the command already owns. */
    expect(METER_PANEL).toContain("preview.ok");
    expect(METER_PANEL).toContain("preview.refusal");
    for (const forbidden of ["ticksPerSlot", "slotCount", "PPQ", "ticksPerBar"]) {
      expect(METER_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("gets the beat count and the tempo from their own readers", () => {
    expect(METER_PANEL).toContain("readRhythm");
    expect(METER_PANEL).toContain("readTempo");
    /* And shows the subdivision line, so three main beats in a 7/8 can never
       be read as three eighths (c2, guardrail 2). */
    expect(METER_PANEL).toContain("reading.subdivision");
  });
});
