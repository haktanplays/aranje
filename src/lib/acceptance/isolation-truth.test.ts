/**
 * Four domains, four answers, and no collapsing (2V-B.1 §4).
 */
import { describe, expect, it } from "vitest";

import {
  domainHash,
  formatIsolationTruth,
  judgeIsolation,
  type IsolationInput,
} from "@/lib/acceptance/isolation-truth";

const clean: IsolationInput = {
  device: {
    available: true,
    initialBytes: '[["aranje.project.project-1","{}"]]',
    finalBytes: '[["aranje.project.project-1","{}"]]',
    writes: 0,
    holdsFixtureKey: false,
  },
  fixture: {
    initialBytes: '{"revision":1}',
    finalBytes: '{"revision":1}',
    songWrites: 6,
    restoreJournalEntries: 0,
  },
  record: {
    initialRevision: 1,
    finalRevision: 1,
    initialHistoryLength: 1,
    finalHistoryLength: 1,
  },
  guide: {
    sessionId: "2vb1-0001",
    sessionInstalled: true,
    cleanup: "clean",
    leftBehind: [],
  },
};

describe("the two hashes cannot be mistaken for each other", () => {
  it("gives the same bytes a different value in each domain", () => {
    expect(domainHash("device", "x")).not.toBe(domainHash("fixture", "x"));
    expect(domainHash("device", "x").startsWith("device:")).toBe(true);
    expect(domainHash("fixture", "x").startsWith("fixture:")).toBe(true);
  });
});

describe("a run that really was isolated", () => {
  const truth = judgeIsolation(clean);

  it("carries every field the round has to report", () => {
    expect(truth).toMatchObject({
      deviceProjectUnchanged: true,
      evalFixtureRestored: true,
      deviceStorageWrites: 0,
      evalSongWrites: 6,
      initialRevision: 1,
      finalRevision: 1,
      initialHistoryLength: 1,
      finalHistoryLength: 1,
      sessionId: "2vb1-0001",
      guideCleanup: "clean",
      isolated: true,
    });
    expect(truth.failures).toEqual([]);
    /* Not vacuous: the clone was written to six times, so "the device was
       untouched" is a claim about a run in which editing really happened. */
    expect(truth.evalSongWrites).toBeGreaterThan(0);
  });

  it("says both worlds out loud, and keeps them apart", () => {
    const block = formatIsolationTruth(truth);
    expect(block).toContain("Cihaz hash: device:");
    expect(block).toContain("Kopya hash: fixture:");
    expect(truth.initialDeviceHash).not.toBe(truth.initialFixtureHash);
  });
});

describe("each domain can fail on its own", () => {
  it("names a device write rather than a general failure", () => {
    const truth = judgeIsolation({
      ...clean,
      device: { ...clean.device, writes: 2 },
    });
    expect(truth.deviceProjectUnchanged).toBe(false);
    expect(truth.failures).toContain("device_storage_writes_expected_0_received_2");
    /* The other three domains are untouched by this one's failure. */
    expect(truth.evalFixtureRestored).toBe(true);
  });

  it("names changed device bytes even when nothing was counted", () => {
    const truth = judgeIsolation({
      ...clean,
      device: { ...clean.device, finalBytes: "[]" },
    });
    expect(truth.failures).toContain("device_project_bytes_changed");
  });

  it("names a clone that did not come back", () => {
    const truth = judgeIsolation({
      ...clean,
      fixture: { ...clean.fixture, finalBytes: '{"revision":4}' },
    });
    expect(truth.evalFixtureRestored).toBe(false);
    expect(truth.failures).toContain("eval_fixture_not_restored");
    expect(truth.deviceProjectUnchanged).toBe(true);
  });

  it("refuses a restore that invented a write", () => {
    const truth = judgeIsolation({
      ...clean,
      fixture: { ...clean.fixture, restoreJournalEntries: 3 },
    });
    expect(truth.failures).toContain("restore_invented_journal_writes_3");
  });

  it("names a revision and a history that ended somewhere else", () => {
    const truth = judgeIsolation({
      ...clean,
      record: { ...clean.record, finalRevision: 3, finalHistoryLength: 2 },
    });
    expect(truth.failures).toContain("revision_expected_1_received_3");
    expect(truth.failures).toContain("history_expected_1_received_2");
  });

  it("names what the guide left standing", () => {
    const truth = judgeIsolation({
      ...clean,
      guide: { ...clean.guide, cleanup: "left_behind", leftBehind: ["loop", "sheet"] },
    });
    expect(truth.failures).toEqual(
      expect.arrayContaining(["guide_left_behind:loop", "guide_left_behind:sheet"]),
    );
  });

  it("refuses a run whose isolated store never installed", () => {
    const truth = judgeIsolation({
      ...clean,
      guide: { ...clean.guide, sessionInstalled: false },
    });
    expect(truth.isolated).toBe(false);
    expect(truth.failures).toContain("session_store_not_installed");
  });

  it("catches a watcher that was reading the clone all along", () => {
    /*
     * The dangerous failure, because every other number looks perfect: zero
     * writes, unchanged bytes, a restored clone. The only thing that gives it
     * away is that the "device" snapshot contains a key that only exists in
     * the disposable store (§16).
     */
    const truth = judgeIsolation({
      ...clean,
      device: { ...clean.device, holdsFixtureKey: true },
    });
    expect(truth.isolated).toBe(false);
    expect(truth.failures).toContain("watcher_read_the_wrong_store");
  });

  it("collects several failures rather than stopping at the first", () => {
    const truth = judgeIsolation({
      device: {
        available: true,
        initialBytes: "a",
        finalBytes: "b",
        writes: 1,
        holdsFixtureKey: true,
      },
      fixture: {
        initialBytes: "a",
        finalBytes: "b",
        songWrites: 0,
        restoreJournalEntries: 2,
      },
      record: {
        initialRevision: 1,
        finalRevision: 5,
        initialHistoryLength: 1,
        finalHistoryLength: 4,
      },
      guide: {
        sessionId: "x",
        sessionInstalled: false,
        cleanup: "not_run",
        leftBehind: [],
      },
    });
    expect(truth.failures.length).toBeGreaterThanOrEqual(8);
    /* Named, every one of them. "KALDI" is not a diagnosis. */
    expect(truth.failures.every((name) => /^[a-z_]/.test(name))).toBe(true);
  });
});
