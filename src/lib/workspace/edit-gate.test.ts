/**
 * Who may edit, after cross-instrument entry (2Q-B §5.3, §14).
 *
 * Written red. The gate refused every track that is not a fretted one,
 * because until this checkpoint the only writing surface *was* the fret
 * sheet. The step grid and the note strip were built behind `editing`, and
 * `editing` could never become true for the instruments they were built for
 * — so the surfaces existed and no reader could reach them.
 *
 * The sentence the gate used to show said so out loud: "yalnız akordu olan
 * telli track'ler düzenlenebiliyor". It is gone because it is no longer
 * true, not because it was inconvenient.
 */
import { describe, expect, it } from "vitest";

import { editGate } from "@/lib/workspace/edit-gate";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Track } from "@/lib/song/schema";

const guitar = SAMPLE_SONG.tracks.find((track) => track.fretboard)!;
const drums = SAMPLE_SONG.tracks.find(
  (track) => track.instrumentId === "drum_kit",
)!;
const keys: Track = {
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
};

const open = { previewOpen: false, canPersist: true };

describe("229. every instrument can be written on now", () => {
  it("lets a fretted track be edited, as it always did", () => {
    expect(editGate({ track: guitar, ...open }).canEdit).toBe(true);
  });

  it("lets a drum kit be edited, which is what the step grid is for", () => {
    const gate = editGate({ track: drums, ...open });
    expect(gate.canEdit).toBe(true);
    expect(gate.editDisabledReason).toBeNull();
  });

  it("lets a fretless track be edited, which is what the note strip is for", () => {
    const gate = editGate({ track: keys, ...open });
    expect(gate.canEdit).toBe(true);
    expect(gate.editDisabledReason).toBeNull();
  });

  it("never says the old sentence about tuned string tracks again", () => {
    for (const track of [guitar, drums, keys, undefined]) {
      for (const previewOpen of [false, true]) {
        for (const canPersist of [false, true]) {
          const reason = editGate({ track, previewOpen, canPersist })
            .editDisabledReason;
          expect(reason ?? "").not.toContain("telli");
        }
      }
    }
  });
});

describe("230. the two reasons editing is still closed", () => {
  it("closes when the session cannot save, and says which", () => {
    const gate = editGate({ track: drums, previewOpen: false, canPersist: false });
    expect(gate.canEdit).toBe(false);
    expect(gate.editDisabledReason).toContain("kaydedilemeyeceği");
  });

  it("closes while a Copilot candidate is on screen, and says which", () => {
    const gate = editGate({ track: drums, previewOpen: true, canPersist: true });
    expect(gate.canEdit).toBe(false);
    // A candidate was measured against an older song; editing under it would
    // be editing music the candidate does not describe.
    expect(gate.editDisabledReason).toContain("öneri");
  });

  it("prefers the storage sentence when both are true", () => {
    const gate = editGate({ track: drums, previewOpen: true, canPersist: false });
    expect(gate.editDisabledReason).toContain("kaydedilemeyeceği");
  });

  it("says nothing at all when there is no track to talk about", () => {
    const gate = editGate({ track: undefined, previewOpen: false, canPersist: true });
    expect(gate.canEdit).toBe(false);
    expect(gate.editDisabledReason).toBeNull();
  });
});
