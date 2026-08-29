/**
 * That the acceptance route cannot reach the reader's own music
 * (2U-A handoff §3).
 *
 * This is the promise the route prints on its own header, and the one that
 * would be worst to get wrong: a founder runs a five-minute test on the phone
 * that holds everything they have written, and an edit made by the test lands
 * in it. Nothing about the screen would say so.
 *
 * So the isolation is asserted at the level a future edit would break it —
 * which files the route is allowed to reach for, and what the installer does
 * when asked twice — rather than by trusting the comment at the top of the
 * conductor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { createMemoryStorage } from "@/lib/acceptance/memory-storage";
import { startAcceptanceSession } from "@/lib/acceptance/session";

const ROUTE_FILES = [
  "src/app/eval/editor-acceptance/page.tsx",
  "src/components/acceptance/EditorAcceptance.tsx",
  "src/components/acceptance/useEditorWatch.ts",
];

const read = (path: string) => readFileSync(path, "utf8");

describe("the route reaches for nothing of the reader's", () => {
  /*
   * `device-storage.ts` is the one module allowed to touch the real store,
   * and it only reads. A component naming a storage API would be a component
   * that could be given a quieter way to write one.
   */
  it("names no storage API in the route's own files", () => {
    for (const path of ROUTE_FILES) {
      expect(read(path), path).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it("builds no storage key of its own", () => {
    for (const path of ROUTE_FILES) {
      expect(read(path), path).not.toMatch(/aranje\.project|aranje\.projects/);
    }
  });

  /* No provider call, no analytics, no permission prompt, no outward fetch. */
  it("asks nothing of the network or the device", () => {
    for (const path of ROUTE_FILES) {
      const text = read(path);
      expect(text, path).not.toMatch(/\bfetch\(|XMLHttpRequest|navigator\.mediaDevices/);
      expect(text, path).not.toMatch(/getUserMedia|Notification\.requestPermission/);
      expect(text, path).not.toMatch(/analytics|gtag|posthog|sentry/i);
    }
  });

  it("is not linked from the product", () => {
    const app = read("src/app/page.tsx");
    expect(app).not.toContain("editor-acceptance");
  });

  it("tells search engines to leave it alone", () => {
    expect(read("src/app/eval/editor-acceptance/page.tsx")).toContain("index: false");
  });
});

describe("the session it runs in", () => {
  it("writes the fixture into a storage nothing else can see", () => {
    const session = startAcceptanceSession(1, editorFixture());
    expect(session.ok).toBe(true);
    expect(session.storage.length).toBeGreaterThan(0);
    /* Everything it wrote is in the Map, and the Map dies with the tab. */
    expect(Object.keys(session.storage.snapshot()).length).toBeGreaterThan(0);
  });

  /*
   * A second install is refused rather than silently accepted, so a page that
   * somehow mounted twice reports the refusal instead of quietly running the
   * test against whatever was already installed.
   */
  it("refuses a second install rather than taking over", () => {
    const second = startAcceptanceSession(1, editorFixture());
    expect(second.ok).toBe(false);
    expect(second.reason ?? "").toContain("zaten kurulmuş");
  });

  it("never hands out the same storage twice", () => {
    expect(createMemoryStorage()).not.toBe(createMemoryStorage());
  });
});
