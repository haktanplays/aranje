import { describe, expect, it } from "vitest";

import { copilotGates } from "@/lib/copilot/gates";
import type { PreviewStatus } from "@/lib/copilot/preview-machine";

const ALL: readonly PreviewStatus[] = [
  "closed",
  "editing_request",
  "submitting",
  "preview_ready",
  "preview_playing",
  "applying",
  "error",
];

describe("which door the Copilot holds open", () => {
  it("shows a candidate for every state a candidate can be in", () => {
    for (const status of ["preview_ready", "preview_playing", "applying"] as const) {
      expect(copilotGates(status).previewOpen).toBe(true);
    }
  });

  it("shows the request sheet while it is written, sent or refused", () => {
    for (const status of ["editing_request", "submitting", "error"] as const) {
      expect(copilotGates(status).arrangeOpen).toBe(true);
    }
  });

  it("holds nothing open when the Copilot is closed", () => {
    expect(copilotGates("closed")).toEqual({ previewOpen: false, arrangeOpen: false });
  });

  it("never opens both doors at once", () => {
    for (const status of ALL) {
      const gates = copilotGates(status);
      expect(gates.previewOpen && gates.arrangeOpen).toBe(false);
    }
  });
});
