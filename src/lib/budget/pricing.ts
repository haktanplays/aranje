/**
 * Model prices (spec 12.4).
 *
 * "Model fiyatları koda gömülmez; sürümlenebilir backend fiyat
 * konfigürasyonundan okunur." So there is no default table in this file and
 * there is no fallback price. A build with no price configuration cannot cost
 * anything out, and a system that cannot cost a request out must not make one.
 *
 * Prices are per million tokens, which is how providers publish them, and are
 * converted to whole micro-dollars for the counters so a day of arithmetic
 * cannot drift the way repeated float addition does.
 */
import { z } from "zod";

const perMillion = z.number().nonnegative();

export const modelPriceSchema = z.strictObject({
  inputPerMTokUsd: perMillion,
  outputPerMTokUsd: perMillion,
  cacheReadPerMTokUsd: perMillion,
  cacheWritePerMTokUsd: perMillion,
});

export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const priceTableSchema = z.strictObject({
  /** Bumped whenever a price changes, so metering rows stay comparable. */
  version: z.string().min(1),
  models: z.record(z.string(), modelPriceSchema),
});

export type PriceTable = z.infer<typeof priceTableSchema>;

export function priceFor(
  table: PriceTable,
  model: string,
): ModelPrice | undefined {
  return table.models[model];
}

/** Parse a price table from configuration text. No table means no default. */
export function parsePriceTable(raw: string | undefined): PriceTable | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = priceTableSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
