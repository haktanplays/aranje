import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createFakeAdapter } from "@/lib/ai/fake-adapter";
import { createFakeClock } from "@/lib/budget/clock";
import { createMemoryKv } from "@/lib/budget/memory-kv";
import { runCopilot } from "@/lib/copilot/pipeline";
import { createMemoryMeter } from "@/lib/metering/events";
import { arrangeAnswer } from "@/lib/ai/fake-skills";
import {
  FIXED_NOW,
  TEST_SONG,
  arrangeRequest,
  mainSection,
  testConfig,
  usage,
} from "@/test/copilot-fixtures";

function modelAnswer(): string {
  const section = mainSection();
  const target = TEST_SONG.tracks.find((track) => track.id === "drums");
  if (!target) throw new Error("fixture has no drum track");
  return arrangeAnswer({
    song: TEST_SONG,
    section,
    target,
    skill: "drums",
    sectionId: section.id,
  });
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("the tests reach no network", () => {
  it("runs a whole request with every outbound door nailed shut", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(String(args[0]));
      throw new Error("a test tried to reach the network");
    }) as typeof fetch;

    try {
      const clock = createFakeClock(FIXED_NOW);
      const outcome = await runCopilot(
        {
          config: testConfig(),
          kv: createMemoryKv(clock),
          clock,
          adapter: createFakeAdapter([
            { kind: "success", raw: modelAnswer(), usage: usage() },
          ]),
          meter: createMemoryMeter(),
          newRequestId: () => "req-1",
          newPatchId: () => "patch-1",
        },
        arrangeRequest("drums"),
      );
      expect(outcome.ok).toBe(true);
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
  });

  /**
   * Exactly two files may call `fetch`, and only to reach our own route. The
   * server side may not call it at all: a provider call would have to start
   * there, and there is no provider.
   */
  const FETCH_ALLOWED = [
    "src/lib/copilot/client.ts",
    "src/lib/copilot/use-co-arranger.ts",
  ];

  it("has no HTTP client in any server-side or pure module", () => {
    const sources = [
      ...walk("src/lib/ai"),
      ...walk("src/lib/budget"),
      ...walk("src/lib/copilot"),
      ...walk("src/lib/config"),
      ...walk("src/lib/metering"),
      ...walk("src/app/api"),
    ].filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

    expect(sources.length).toBeGreaterThan(10);

    const offenders = sources.filter((file) => {
      if (FETCH_ALLOWED.includes(file)) return false;
      const text = readFileSync(file, "utf8");
      return (
        /\bfetch\s*\(/.test(text) ||
        /from "node:https?"/.test(text) ||
        /require\("node:https?"\)/.test(text) ||
        /new WebSocket\(/.test(text) ||
        /XMLHttpRequest/.test(text)
      );
    });

    expect(offenders).toEqual([]);
  });

  it("lets the two client files reach nothing but our own route", () => {
    for (const file of FETCH_ALLOWED) {
      const text = readFileSync(file, "utf8");
      // Same-origin only: no absolute URL, no other host, no provider domain.
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toContain("anthropic");
      expect(text).not.toContain("openai");
    }
    expect(readFileSync("src/lib/copilot/client.ts", "utf8")).toContain(
      '"/api/copilot"',
    );
  });

  it("declares no provider SDK as a dependency", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = [
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
    ];

    for (const forbidden of [
      "@anthropic-ai/sdk",
      "openai",
      "@google/generative-ai",
      "@upstash/redis",
      "@vercel/kv",
      "ioredis",
      "redis",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
