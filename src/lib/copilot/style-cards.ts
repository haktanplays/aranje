/**
 * Style cards (spec 11.7, decision K-18).
 *
 * The cards are **trait-based**. K-18 removed the artist-named card: a card
 * that names a band is an instruction to imitate a specific body of work, and
 * that is neither what we want to ask a model for nor something to ship. What
 * is left describes a texture — how dense, how much space, what the bass and
 * drums do under the part — which is the useful half anyway.
 *
 * Cards live in the **instruction layer**: they are our words, added to the
 * system prompt, and they stay byte-stable for a given card so the cacheable
 * prefix of spec 11.5 keeps its shape. The song and the musician's words stay
 * in the data layer, behind the fence. The two never mix.
 *
 * The bodies are read from `content/styles/*.md` by the caller; this module
 * only says which cards exist, so nothing in the pure path touches a file.
 *
 * Each card carries two worked examples, as spec 11.7 asks for. They are
 * written in the narrow `arrange_track` output shape so a test can parse them
 * against the same strict schema a provider answer goes through — a card that
 * shows a model an example the contract would reject teaches it the wrong
 * thing. `extractExamples` is how that test reads them back out.
 */
import type { StyleCard } from "@/lib/copilot/prompt";

export const STYLE_CARD_IDS = [
  "generic-metal",
  "progressive-atmospheric-acoustic",
] as const;

export type StyleCardId = (typeof STYLE_CARD_IDS)[number];

export function isStyleCardId(value: string): value is StyleCardId {
  return (STYLE_CARD_IDS as readonly string[]).includes(value);
}

/** Where a card's text lives, relative to the repository root. */
export function styleCardPath(id: StyleCardId): string {
  return `content/styles/${id}.md`;
}

export type StyleCardRegistry = Readonly<Record<string, StyleCard>>;

/** Build a registry from bodies the caller has already read. */
export function styleCardRegistry(
  bodies: Readonly<Record<string, string>>,
): StyleCardRegistry {
  const registry: Record<string, StyleCard> = {};
  for (const id of STYLE_CARD_IDS) {
    const body = bodies[id];
    if (body !== undefined) registry[id] = { id, body };
  }
  return registry;
}

/** Fenced JSON blocks in a card body, in the order they appear. */
export function extractExamples(body: string): unknown[] {
  const blocks: unknown[] = [];
  const fence = /```json\n([\s\S]*?)```/g;
  for (const match of body.matchAll(fence)) {
    const text = match[1];
    if (text === undefined) continue;
    blocks.push(JSON.parse(text) as unknown);
  }
  return blocks;
}
