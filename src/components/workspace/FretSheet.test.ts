/**
 * What the fret sheet can write (2T-C §9).
 *
 * The first of the five links: a technique nobody can choose is not a
 * technique the app has. The sheet builds its chips from the matrix, so this
 * test is what keeps the two honest — a row added to the contract without a
 * way of reaching it fails here.
 */
import { describe, expect, it } from "vitest";

import { FRET_SHEET_ARTICULATIONS } from "@/components/workspace/FretSheet";
import { matrixArticulations } from "@/lib/song/technique-matrix";
import { articulationLabel } from "@/lib/validators";

describe("the sheet's technique chips", () => {
  it("offer every articulation the matrix claims", () => {
    expect([...FRET_SHEET_ARTICULATIONS].sort()).toEqual(
      [...matrixArticulations()].sort(),
    );
  });

  it("offer each one exactly once", () => {
    expect(new Set(FRET_SHEET_ARTICULATIONS).size).toBe(
      FRET_SHEET_ARTICULATIONS.length,
    );
  });

  it("show a name, never an enum value", () => {
    for (const articulation of FRET_SHEET_ARTICULATIONS) {
      const label = articulationLabel(articulation);
      expect(label).not.toBe(articulation);
      expect(label).not.toMatch(/_/);
    }
  });
});
