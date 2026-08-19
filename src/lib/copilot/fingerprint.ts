/**
 * A stable fingerprint of what was asked (spec 12.3 idempotency).
 *
 * Two requests are "the same request" when they would produce the same answer.
 * That is everything the model sees — the kind, the anchor, the prompt, the
 * style card and the song — and nothing else. The idempotency key itself is
 * not part of it (it is the label, not the content) and neither is the caller
 * identity (it is the namespace the label lives in).
 *
 * The fingerprint is a hash, never the payload. Spec 12.2 keeps song data out
 * of the counter store, so the song is hashed and thrown away rather than
 * written anywhere near a key.
 */
import { stableHash } from "@/lib/budget/keys";
import type { CopilotRequest } from "@/lib/copilot/contract";

/** JSON with keys in a fixed order, so object literal order cannot matter. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export async function requestFingerprint(
  request: CopilotRequest,
): Promise<string> {
  const anchor =
    request.kind === "generation"
      ? { kind: request.kind, afterSectionId: request.afterSectionId }
      : { kind: request.kind, targetSectionId: request.targetSectionId };

  return stableHash(
    canonicalJson({
      ...anchor,
      prompt: request.prompt,
      styleId: request.styleId ?? null,
      song: request.song,
    }),
  );
}
