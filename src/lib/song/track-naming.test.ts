/**
 * What a track a reader adds is called (2V-E.1 §11).
 *
 * The walk artefact recorded the row as `Elektro gitarElektro gitar`: the
 * sheet named the new track after its instrument, and the row already prints
 * the instrument beside the name. Two guitars therefore read identically and
 * neither said which was which.
 */
import { describe, expect, it } from "vitest";

import { dedupeName, numberedName } from "@/lib/song/lifecycle-ids";
import { trackRoleName } from "@/lib/instruments/labels";
import { materializeTemplate } from "@/lib/song/song-templates";

describe("408. the role word a track goes by", () => {
  it("is the short one the starting templates already use", () => {
    expect(trackRoleName("electric_guitar")).toBe("Gitar");
    expect(trackRoleName("electric_bass")).toBe("Bas");
    expect(trackRoleName("drum_kit")).toBe("Davul");
    expect(trackRoleName("steel_acoustic")).toBe("Akustik Gitar");
  });

  it("is not the instrument's own name, which is the defect", () => {
    expect(trackRoleName("electric_guitar")).not.toBe("Elektro gitar");
  });

  it("falls back to something a reader recognises, never an id", () => {
    expect(trackRoleName("no_such_instrument")).toBe("no_such_instrument");
    expect(trackRoleName("piano")).toBe("Piyano");
  });

  it("names every track the band template starts with", () => {
    const band = materializeTemplate("rock_band");
    expect(band).not.toBeNull();
    expect(band!.tracks.length).toBeGreaterThan(1);
    for (const track of band!.tracks) {
      const role = trackRoleName(track.instrumentId);
      expect(track.name.startsWith(role), `${track.name} vs ${role}`).toBe(true);
    }
  });
});

describe("409. the number after it", () => {
  it("continues the series the template started", () => {
    expect(numberedName(["Gitar 1"], "Gitar")).toBe("Gitar 2");
    expect(numberedName(["Gitar 1", "Gitar 2"], "Gitar")).toBe("Gitar 3");
  });

  /*
   * The non-vacuity guard, and the reason this is not `dedupeName`: beside a
   * "Gitar 1", `dedupeName` returns the bare role because nothing is called
   * exactly that — a song whose tracks read "Gitar 1" and "Gitar".
   */
  it("is not what dedupeName would have said", () => {
    expect(dedupeName(["Gitar 1"], "Gitar")).toBe("Gitar");
    expect(numberedName(["Gitar 1"], "Gitar")).not.toBe(dedupeName(["Gitar 1"], "Gitar"));
  });

  it("takes the one after the highest, not after the count", () => {
    /* "Gitar 2" was deleted; the next one is 4, so nothing collides. */
    expect(numberedName(["Gitar 1", "Gitar 3"], "Gitar")).toBe("Gitar 4");
  });

  it("counts an unnumbered name as the first", () => {
    expect(numberedName(["Gitar"], "Gitar")).toBe("Gitar 2");
  });

  it("ignores names in another series", () => {
    expect(numberedName(["Bas 1", "Davul 1"], "Gitar")).toBe("Gitar 1");
    expect(numberedName(["Gitar 1", "Bas 4"], "Bas")).toBe("Bas 5");
  });

  it("ignores a name that only starts with the role", () => {
    expect(numberedName(["Gitar solosu"], "Gitar")).toBe("Gitar 1");
  });

  /*
   * The other anchor, and it needs its own case: "Solo Gitar 2" *ends* the
   * way a numbered guitar does. Without the leading anchor it would be read
   * as the second guitar and the next one would come out "Gitar 3", beside
   * a song that has no Gitar 1 or 2 in it at all.
   */
  it("ignores a name that only ends like the role", () => {
    expect(numberedName(["Solo Gitar 2"], "Gitar")).toBe("Gitar 1");
  });

  it("treats a role with regex characters as text", () => {
    expect(numberedName(["Gitar (sol) 2"], "Gitar (sol)")).toBe("Gitar (sol) 3");
  });

  it("never repeats a name that is already taken", () => {
    const taken = ["Gitar 1", "Gitar 2", "Gitar 3"];
    expect(taken).not.toContain(numberedName(taken, "Gitar"));
  });
});
