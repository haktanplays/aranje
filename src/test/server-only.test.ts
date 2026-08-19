import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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

const SERVER_ONLY_MODULES = [
  "@/lib/config/copilot",
  "@/lib/copilot/pipeline",
  "@/lib/copilot/runtime",
  "@/lib/budget/reservation",
  "@/lib/budget/pricing",
  "@/lib/budget/keys",
  "@/lib/ai/adapter",
  "@/lib/ai/fake-adapter",
];

const SOURCES = [...walk("src/app"), ...walk("src/components"), ...walk("src/lib")]
  .filter((file) => /\.tsx?$/.test(file))
  .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));

describe("backend secrets stay on the backend (spec 12.1)", () => {
  it("has sources to check", () => {
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  it("exposes no ARANJE backend setting under a NEXT_PUBLIC name", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
        // Spec 14.2 allows exactly one public variable, the API base URL.
        if (match[0] === "NEXT_PUBLIC_ARANJE_API_BASE") continue;
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads process.env only from server files", () => {
    const readers = SOURCES.filter((file) =>
      /process\.env/.test(readFileSync(file, "utf8")),
    );
    // Only the route handler, which never runs in a browser.
    expect(readers).toEqual(["src/app/api/copilot/route.ts"]);
  });

  it("keeps every client component clear of the server modules", () => {
    const clientFiles = SOURCES.filter((file) =>
      /^\s*["']use client["']/m.test(readFileSync(file, "utf8")),
    );
    expect(clientFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of clientFiles) {
      const text = readFileSync(file, "utf8");
      for (const specifier of SERVER_ONLY_MODULES) {
        if (text.includes(`"${specifier}"`)) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps budget and model names out of any built client chunk", () => {
    const staticDir = ".next/static";
    if (!existsSync(staticDir)) {
      // The source-level checks above are the standing guarantee; this one
      // adds a look at the real output whenever a build is present.
      expect(existsSync(staticDir)).toBe(false);
      return;
    }

    const chunks = walk(staticDir).filter((file) => file.endsWith(".js"));
    expect(chunks.length).toBeGreaterThan(0);

    const forbidden = [
      "ARANJE_PRICE_TABLE",
      "ARANJE_DAILY_AI_BUDGET_USD",
      "ARANJE_MONTHLY_AI_BUDGET_USD",
      "ARANJE_MAX_INPUT_TOKENS",
      "ARANJE_MAX_OUTPUT_TOKENS",
      "ARANJE_MODEL_DEFAULT",
      "ARANJE_ENABLE_CHEAP_ROUTING",
    ];

    const offenders: string[] = [];
    for (const chunk of chunks) {
      const text = readFileSync(chunk, "utf8");
      for (const name of forbidden) {
        if (text.includes(name)) offenders.push(`${chunk}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
