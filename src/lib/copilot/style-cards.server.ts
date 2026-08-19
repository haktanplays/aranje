/**
 * Reading the style cards off disk (spec 11.7).
 *
 * Server only, and kept apart from `style-cards.ts` for exactly that reason:
 * the pure module says which cards exist and can be imported anywhere, while
 * this one touches the filesystem and may only be reached from a route.
 *
 * Spec 11.7 reads the cards at route or build time. A missing card is not an
 * error worth refusing a request over — the prompt simply carries no card —
 * so a read failure is silence rather than a throw.
 */
import { readFileSync } from "node:fs";

import {
  STYLE_CARD_IDS,
  styleCardPath,
  styleCardRegistry,
  type StyleCardRegistry,
} from "@/lib/copilot/style-cards";

export function readStyleCards(): StyleCardRegistry {
  const bodies: Record<string, string> = {};
  for (const id of STYLE_CARD_IDS) {
    try {
      bodies[id] = readFileSync(styleCardPath(id), "utf8");
    } catch {
      // A card that cannot be read is a card the prompt goes without.
    }
  }
  return styleCardRegistry(bodies);
}
