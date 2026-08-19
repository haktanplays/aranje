import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createFakeAdapter } from "@/lib/ai/fake-adapter";
import { createFakeClock } from "@/lib/budget/clock";
import { createMemoryKv } from "@/lib/budget/memory-kv";
import { runCopilot } from "@/lib/copilot/pipeline";
import { createMemoryMeter } from "@/lib/metering/events";
import {
  FIXED_NOW,
  generationRequest,
  modelAnswer,
  testConfig,
  usage,
} from "@/test/copilot-fixtures";

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
        generationRequest(),
      );
      expect(outcome.ok).toBe(true);
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
  });

  it("has no HTTP client anywhere in the copilot, budget or adapter code", () => {
    const sources = [
      ...walk("src/lib/ai"),
      ...walk("src/lib/budget"),
      ...walk("src/lib/copilot"),
      ...walk("src/lib/config"),
      ...walk("src/lib/metering"),
      ...walk("src/app/api"),
    ].filter((file) => file.endsWith(".ts"));

    expect(sources.length).toBeGreaterThan(10);

    const offenders = sources.filter((file) => {
      const text = readFileSync(file, "utf8");
      return (
        /\bfetch\s*\(/.test(text) ||
        /from "node:https?"/.test(text) ||
        /require\("node:https?"\)/.test(text) ||
        /new WebSocket\(/.test(text) ||
        /XMLHttpRequest/.test(text)
      );
    });

    // Not one line of this checkpoint talks to a provider.
    expect(offenders).toEqual([]);
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
