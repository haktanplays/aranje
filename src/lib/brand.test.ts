import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BRAND_NAME, BRAND_SLUG } from "@/lib/brand";

/** The accented character, written as an escape so this file stays ASCII. */
const ACCENTED = "\u00E9";

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

describe("brand name (spec 1.4)", () => {
  it("renders the accented brand for the reader", () => {
    expect(BRAND_NAME).toBe(`Aranj${ACCENTED}`);
  });

  it("keeps an ASCII slug for technical identifiers", () => {
    expect(BRAND_SLUG).toBe("aranje");
    expect(/^[a-z]+$/.test(BRAND_SLUG)).toBe(true);
  });

  it("has no raw accented character anywhere under src or public", () => {
    const files = [...walk("src"), ...walk("public")];
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter(
      (file) =>
        file.includes(ACCENTED) || readFileSync(file, "utf8").includes(ACCENTED),
    );

    expect(offenders).toEqual([]);
  });
});
