/**
 * The save line says what happened, and never before it happened
 * (2V-E.1 §7).
 */
import { describe, expect, it } from "vitest";

import { SAVE_RETRY_LABEL, saveStatus } from "@/lib/home/save-status";

const snapshot = (over: Partial<Parameters<typeof saveStatus>[0]> = {}) =>
  saveStatus({ persisted: true, canPersist: true, pending: false, ...over });

describe("399. what the reader is told about saving", () => {
  it("says saved only when the write has already come back", () => {
    expect(snapshot().state).toBe("saved");
    expect(snapshot().text).toBe("Kaydedildi");
  });

  it("never says saved while a write is still in flight", () => {
    /* The one ordering that matters: a status that ran ahead of the write
       would be the app telling the reader their music is safe before it is. */
    const inFlight = snapshot({ pending: true });
    expect(inFlight.state).toBe("saving");
    expect(inFlight.text).toBe("Kaydediliyor…");
    expect(inFlight.text).not.toBe("Kaydedildi");
  });

  it("says a failure is a failure, and offers the one thing that helps", () => {
    const failed = snapshot({ persisted: false });
    expect(failed.state).toBe("failed");
    expect(failed.text).toBe("Kaydedilemedi");
    expect(failed.retryable).toBe(true);
    expect(SAVE_RETRY_LABEL).toBe("Tekrar dene");
  });

  it("distinguishes a failed write from a device that never allowed one", () => {
    /* Different sentences because they need different actions: one is worth
       retrying, the other is worth changing a browser setting. */
    const readOnly = snapshot({ canPersist: false });
    expect(readOnly.state).toBe("read_only");
    expect(readOnly.retryable).toBe(false);
    expect(readOnly.text).not.toBe(snapshot({ persisted: false }).text);
  });

  it("a pending write on a read-only device is still read-only", () => {
    expect(saveStatus({ persisted: true, canPersist: false, pending: true }).state).toBe(
      "read_only",
    );
  });

  it("shows no code, key or diagnostic in any of the four", () => {
    const all = [
      snapshot(),
      snapshot({ pending: true }),
      snapshot({ persisted: false }),
      snapshot({ canPersist: false }),
    ]
      .map((status) => status.text ?? "")
      .join(" ");
    expect(all).not.toMatch(/aranje\.|quota|localStorage|project-|error|exception/i);
  });
});
