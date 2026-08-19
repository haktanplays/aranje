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

  it("has no raw accented character in any file name under src or public", () => {
    const files = [...walk("src"), ...walk("public")];
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => file.includes(ACCENTED))).toEqual([]);
  });

  it("has no raw accented character in any source file", () => {
    // Only text is scanned. A binary asset is not source, and reading one as
    // UTF-8 can turn arbitrary bytes into the character we are looking for.
    const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|html|svg|txt)$/;
    const sources = [...walk("src"), ...walk("public")].filter((file) =>
      TEXT.test(file),
    );
    expect(sources.length).toBeGreaterThan(0);

    const offenders = sources.filter((file) =>
      readFileSync(file, "utf8").includes(ACCENTED),
    );

    expect(offenders).toEqual([]);
  });
});
