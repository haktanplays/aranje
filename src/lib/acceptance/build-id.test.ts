/**
 * That a stale deploy cannot be accepted by mistake (2U-A handoff §4).
 *
 * The failure this guards against is quiet: the link opens, the page looks
 * exactly right, and the founder accepts a build from last week. Nothing on
 * screen would say so — which is why the version has to be compared rather
 * than displayed.
 */
import { describe, expect, it } from "vitest";

import { mayStart, shortSha, versionGate } from "@/lib/acceptance/build-id";

const FULL = "5d2bb182eb1f10eda38462cfe89ef3ba67df700d";

describe("comparing what was asked for with what answered", () => {
  it("accepts the full hash behind a short expectation", () => {
    const gate = versionGate("5d2bb18", FULL);
    expect(gate.kind).toBe("match");
    expect(mayStart(gate)).toBe(true);
  });

  it("accepts a short build behind a full expectation", () => {
    expect(versionGate(FULL, "5d2bb18").kind).toBe("match");
  });

  it("does not care about case", () => {
    expect(versionGate("5D2BB18", FULL).kind).toBe("match");
  });

  it("refuses a different build, and says both versions", () => {
    const gate = versionGate("5d2bb18", "7d3e86c1111111111111111111111111111111111");
    expect(gate.kind).toBe("mismatch");
    expect(mayStart(gate)).toBe(false);
    if (gate.kind !== "mismatch") return;
    expect(gate.message).toBe("Yanlış sürüm: beklenen 5d2bb18, açılan 7d3e86c");
  });

  /*
   * A build that cannot say where it came from is not a passing build. It is
   * the case the founder is most likely to hit on a host that strips git, and
   * treating it as a match is exactly how a stale deploy gets through.
   */
  it("refuses to start when the build does not know its own commit", () => {
    const gate = versionGate("5d2bb18", "unknown");
    expect(gate.kind).toBe("unknown");
    expect(mayStart(gate)).toBe(false);
  });

  /* Development, and honest about it: the run happens and the block says so. */
  it("runs unpinned when no version was asked for", () => {
    for (const empty of [null, "", "   "]) {
      const gate = versionGate(empty, FULL);
      expect(gate.kind, JSON.stringify(empty)).toBe("unpinned");
      expect(mayStart(gate)).toBe(true);
    }
  });

  it("shortens a hash the way a commit is spoken about", () => {
    expect(shortSha(FULL)).toBe("5d2bb18");
    expect(shortSha("unknown")).toBe("unknown");
  });
});
