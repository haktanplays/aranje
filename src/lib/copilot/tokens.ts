/**
 * Token estimation for the ceilings of spec 11.3.
 *
 * This is an estimate, and it is written to be an over-estimate. It exists so
 * `ARANJE_MAX_INPUT_TOKENS` can be enforced before a request is built, which
 * is a check that has to run without asking anyone anything.
 *
 * It is not a tokenizer, and it must not be mistaken for one. Before a real
 * provider is wired, the ceiling check has to be re-based on that provider's
 * own token counting, and the ratio below replaced by a measured one. Until
 * then, erring high is the safe direction: an over-estimate rejects a request
 * that would have fit, while an under-estimate lets one through that does not.
 */

/**
 * Characters per token. English prose runs near four; note names, Turkish and
 * punctuation-dense compact lines run shorter, so three is used to stay on the
 * pessimistic side of every one of them.
 */
export const CHARS_PER_TOKEN = 3;

/** Per-message framing the provider adds around content. */
const MESSAGE_OVERHEAD_TOKENS = 8;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimated input for a whole prompt: every block plus its framing. */
export function estimatePromptTokens(blocks: readonly string[]): number {
  return blocks.reduce(
    (total, block) => total + estimateTokens(block) + MESSAGE_OVERHEAD_TOKENS,
    0,
  );
}
