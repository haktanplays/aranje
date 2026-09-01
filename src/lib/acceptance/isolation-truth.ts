/**
 * Four state domains, measured apart (2V-B.1 §4).
 *
 * The last round's result block said one thing — "Proje değişmedi" — and that
 * one thing was standing in for four questions that have four different
 * answers:
 *
 * 1. **The device's own music.** The reader's real projects, on the real
 *    store. This must be byte-identical before, during and after, and it must
 *    be written to exactly zero times.
 * 2. **The disposable clone.** The fixture the test edits. This is *supposed*
 *    to change — editing is the thing being tested — and it must come back to
 *    where it started when the run is over.
 * 3. **The record and the history.** How many committed edits happened, and
 *    how many steps the reader could walk back. A revision that moved by two
 *    where one edit was made is a defect even when both bytes look right.
 * 4. **The session's own screen state.** Which step the guide is on, and
 *    whether it put itself away.
 *
 * Collapsing those into one sentence is how a run reports a clean device while
 * the fixture silently failed to restore, or reports a restored fixture while
 * the revision counter says three edits happened where one was made. So each
 * is carried separately, hashed separately, and named separately in the
 * result — and the device's hash and the clone's hash are given different
 * prefixes so that a reader comparing two numbers on a phone screen cannot
 * mistake one domain for the other.
 *
 * Nothing here reads storage. It is handed what the watcher, the session and
 * the store measured, and its whole job is to say what those measurements
 * mean — which is why it can be tested without a browser.
 */
import { storageHash } from "@/lib/acceptance/device-storage";

/** Which state a hash belongs to. Never interchangeable, so never equal. */
export type IsolationDomain = "device" | "fixture";

/**
 * A hash that says which world it came from.
 *
 * `storageHash` alone gives `b412h7x1k`, and two of those side by side on a
 * phone screen are two anonymous strings a tired reader will compare in the
 * wrong order. The domain is part of the value rather than part of the label
 * beside it, so even a report that lost its labels cannot say the device's
 * bytes and the clone's bytes are the same thing.
 */
export function domainHash(domain: IsolationDomain, bytes: string): string {
  return `${domain}:${storageHash(bytes)}`;
}

export type DeviceDomain = {
  /** False when the browser refuses storage; the run cannot claim anything. */
  readonly available: boolean;
  readonly initialBytes: string;
  readonly finalBytes: string;
  /** Same-document writes to production project keys, counted as they happen. */
  readonly writes: number;
  /**
   * True when the device's snapshot contains the acceptance fixture's own key.
   *
   * It never should: the fixture lives in a `Map` this page owns. If it does,
   * either something escaped into the reader's storage or — the reason this
   * field exists — the watcher is looking at the wrong store, and every "zero
   * writes, bytes unchanged" number above it is measuring the clone and
   * reporting it as the device (§16).
   */
  readonly holdsFixtureKey: boolean;
};

export type FixtureDomain = {
  readonly initialBytes: string;
  readonly finalBytes: string;
  /** Writes to the fixture's own project key, from the storage's own journal. */
  readonly songWrites: number;
  /**
   * Journal entries the cleanup itself added.
   *
   * Restoring the clone is not an edit and must not look like one. A restore
   * implemented as a series of `setItem` calls would leave a trail the ledger
   * would then count as production writes — so `MemoryStorage.restore` writes
   * the entries back without journalling, and this is the number that proves
   * it stayed that way.
   */
  readonly restoreJournalEntries: number;
};

export type RecordDomain = {
  readonly initialRevision: number;
  readonly finalRevision: number;
  readonly initialHistoryLength: number;
  readonly finalHistoryLength: number;
};

/** Whether the guide put its own state away when the run ended. */
export type GuideCleanup = "clean" | "left_behind" | "not_run";

export type GuideDomain = {
  readonly sessionId: string;
  /** False when the isolated store or the settings store refused to install. */
  readonly sessionInstalled: boolean;
  readonly cleanup: GuideCleanup;
  /** What was still standing, named, when the cleanup was not clean. */
  readonly leftBehind: readonly string[];
};

export type IsolationInput = {
  readonly device: DeviceDomain;
  readonly fixture: FixtureDomain;
  readonly record: RecordDomain;
  readonly guide: GuideDomain;
};

/**
 * The fields a 2V-B.1 result block has to carry, and nothing softer.
 *
 * Every name here is the name §4 asks for. A report that renders this object
 * cannot quietly answer a different question than the one it was asked.
 */
export type IsolationTruth = {
  readonly deviceProjectUnchanged: boolean;
  readonly evalFixtureRestored: boolean;
  readonly deviceStorageWrites: number;
  readonly evalSongWrites: number;
  readonly initialDeviceHash: string;
  readonly finalDeviceHash: string;
  readonly initialFixtureHash: string;
  readonly finalFixtureHash: string;
  readonly initialRevision: number;
  readonly finalRevision: number;
  readonly initialHistoryLength: number;
  readonly finalHistoryLength: number;
  readonly sessionId: string;
  readonly guideCleanup: GuideCleanup;
  /** Named, never collapsed into one word (§5). Empty means it held. */
  readonly failures: readonly string[];
  readonly isolated: boolean;
};

export function judgeIsolation(input: IsolationInput): IsolationTruth {
  const { device, fixture, record, guide } = input;
  const failures: string[] = [];

  /*
   * The session first. A refused install means the workspace would have been
   * running over the reader's real storage, and every number below it would
   * be describing their music rather than a clone (§4). That is not a note on
   * a run that continued; it is the run not being entitled to have started.
   */
  if (!guide.sessionInstalled) failures.push("session_store_not_installed");

  if (!device.available) failures.push("device_storage_unavailable");
  if (device.holdsFixtureKey) failures.push("watcher_read_the_wrong_store");

  const deviceUnchanged = device.initialBytes === device.finalBytes;
  if (!deviceUnchanged) failures.push("device_project_bytes_changed");
  if (device.writes !== 0) {
    failures.push(`device_storage_writes_expected_0_received_${device.writes}`);
  }

  const fixtureRestored = fixture.initialBytes === fixture.finalBytes;
  if (!fixtureRestored) failures.push("eval_fixture_not_restored");
  if (fixture.restoreJournalEntries !== 0) {
    failures.push(
      `restore_invented_journal_writes_${fixture.restoreJournalEntries}`,
    );
  }

  /*
   * The clone came back, so the counters have to agree that it did. A
   * revision or a history depth that ends somewhere else is a restore that
   * put the bytes back without putting the session back — and the next step
   * would then be measured against a history it does not have.
   */
  if (record.finalRevision !== record.initialRevision) {
    failures.push(
      `revision_expected_${record.initialRevision}_received_${record.finalRevision}`,
    );
  }
  if (record.finalHistoryLength !== record.initialHistoryLength) {
    failures.push(
      `history_expected_${record.initialHistoryLength}_received_${record.finalHistoryLength}`,
    );
  }

  if (guide.cleanup === "left_behind") {
    for (const name of guide.leftBehind) failures.push(`guide_left_behind:${name}`);
    if (guide.leftBehind.length === 0) failures.push("guide_left_behind");
  }
  if (guide.cleanup === "not_run") failures.push("guide_cleanup_not_run");

  return {
    deviceProjectUnchanged: deviceUnchanged && device.writes === 0,
    evalFixtureRestored: fixtureRestored,
    deviceStorageWrites: device.writes,
    evalSongWrites: fixture.songWrites,
    initialDeviceHash: domainHash("device", device.initialBytes),
    finalDeviceHash: domainHash("device", device.finalBytes),
    initialFixtureHash: domainHash("fixture", fixture.initialBytes),
    finalFixtureHash: domainHash("fixture", fixture.finalBytes),
    initialRevision: record.initialRevision,
    finalRevision: record.finalRevision,
    initialHistoryLength: record.initialHistoryLength,
    finalHistoryLength: record.finalHistoryLength,
    sessionId: guide.sessionId,
    guideCleanup: guide.cleanup,
    failures,
    isolated: failures.length === 0,
  };
}

/**
 * The isolation block, as the founder copies it out of the page.
 *
 * Four labelled groups rather than one line, in the order §4 names them, so
 * that "the device is fine but the clone did not come back" is a thing the
 * block can actually say.
 */
export function formatIsolationTruth(truth: IsolationTruth): string {
  return [
    `Oturum: ${truth.sessionId}`,
    `Cihaz projesi değişmedi: ${truth.deviceProjectUnchanged ? "evet" : "HAYIR"}`,
    `Cihaz deposuna yazma: ${truth.deviceStorageWrites}`,
    `Cihaz hash: ${truth.initialDeviceHash} → ${truth.finalDeviceHash}`,
    `Test kopyası geri yüklendi: ${truth.evalFixtureRestored ? "evet" : "HAYIR"}`,
    `Test kopyasına yazma: ${truth.evalSongWrites}`,
    `Kopya hash: ${truth.initialFixtureHash} → ${truth.finalFixtureHash}`,
    `Revizyon: ${truth.initialRevision} → ${truth.finalRevision}`,
    `Geçmiş adımı: ${truth.initialHistoryLength} → ${truth.finalHistoryLength}`,
    `Rehber temizliği: ${truth.guideCleanup}`,
    `İzolasyon: ${truth.isolated ? "TAMAM" : truth.failures.join(" · ")}`,
  ].join("\n");
}
