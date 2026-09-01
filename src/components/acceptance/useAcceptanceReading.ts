"use client";

/**
 * A read-only window onto the record an acceptance route owns (2V-B §8).
 *
 * ## Why it is the record and not a counter
 *
 * The obvious way to measure "did that write" is to wrap `setItem` and count.
 * On these routes that measures nothing: the page owns a storage made of a
 * `Map`, so a wrapper around the device's `localStorage` reads a structural
 * zero and reports it as a proof. That is the vacuity 2U-C was caught by.
 *
 * So the numbers are the app's own. The bytes are what the record holds, and
 * the revision is the counter the project session bumps once per committed
 * edit — one history step and one storage write, said by the thing that did
 * them.
 *
 * Nothing here writes. It is installed for the duration of a mount and taken
 * off again, and a harness that finds it absent is looking at a page that is
 * not an acceptance route.
 */
import { useEffect } from "react";

import { readFixture } from "@/lib/acceptance/fixture-read";
import type { StorageLike } from "@/lib/song/storage";

export type AcceptanceReading = {
  /** The stored Song, byte for byte, as the page's own storage holds it. */
  bytes(): string;
  /** One per committed edit: a revision that moved is a command that ran. */
  revision(): number;
};

declare global {
  interface Window {
    __aranjeAcceptance?: AcceptanceReading;
  }
}

export function useAcceptanceReading(storage: StorageLike): void {
  useEffect(() => {
    const reading: AcceptanceReading = {
      bytes: () => JSON.stringify(readFixture(storage).song),
      revision: () => readFixture(storage).revision,
    };
    window.__aranjeAcceptance = reading;
    return () => {
      if (window.__aranjeAcceptance === reading) delete window.__aranjeAcceptance;
    };
  }, [storage]);
}
