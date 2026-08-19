/**
 * Backend configuration for the copilot (spec 11.2, 11.3, 12.1).
 *
 * These are backend environment variables. Spec 12.1: "Bu değerler backend
 * ortam değişkenleridir; istemci veya APK tarafından değiştirilemez." Nothing
 * here is read in the browser, and nothing here may be prefixed NEXT_PUBLIC_.
 *
 * The names and the values that spec 11.2 and 12.1 print are the defaults.
 * The two that spec 11.3 leaves to be decided before phase 2 —
 * `ARANJE_MAX_INPUT_TOKENS` and `ARANJE_MAX_OUTPUT_TOKENS` — are given
 * concrete numbers here, which is the decision spec 14.5 asks for as an entry
 * condition. They are sized for the compact transport format of spec 11.5:
 * three sections of compact rows plus the fixed block, and one section of JSON
 * back.
 *
 * There is no default price table. Spec 12.4 keeps prices in a versioned
 * backend configuration, so an unconfigured build has no prices, cannot cost a
 * request out, and refuses to make one.
 */
import { parsePriceTable, type PriceTable } from "@/lib/budget/pricing";

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_MODEL_CHEAP = "claude-haiku-4-5-20251001";

/** Spec 11.3, decided here as the phase 2 entry condition of spec 14.5. */
export const DEFAULT_MAX_INPUT_TOKENS = 8000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4000;

/** Spec 12.1. */
export const DEFAULT_DAILY_BUDGET_USD = 2;
export const DEFAULT_MONTHLY_BUDGET_USD = 20;
export const DEFAULT_FREE_PATCHES_PER_DAY = 3;

export type CopilotConfig = {
  modelDefault: string;
  modelCheap: string;
  modelEscalation: string;
  enableCheapRouting: boolean;
  cheapModelVerifiedAt?: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  freePatchesPerUserPerDay: number;
  priceTable: PriceTable;
};

export type ConfigProblem = { field: string; reason: string };

export type ConfigResult =
  | { ok: true; config: CopilotConfig }
  | { ok: false; problems: ConfigProblem[] };

export type Env = Readonly<Record<string, string | undefined>>;

function readInt(
  env: Env,
  name: string,
  fallback: number,
  problems: ConfigProblem[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    problems.push({ field: name, reason: "pozitif bir tam sayi olmali" });
    return fallback;
  }
  return value;
}

function readNumber(
  env: Env,
  name: string,
  fallback: number,
  problems: ConfigProblem[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    problems.push({ field: name, reason: "pozitif bir sayi olmali" });
    return fallback;
  }
  return value;
}

/** Only the exact string "true" enables a flag; anything else is off. */
function readFlag(env: Env, name: string): boolean {
  return env[name] === "true";
}

export function loadCopilotConfig(env: Env): ConfigResult {
  const problems: ConfigProblem[] = [];

  const priceTable = parsePriceTable(env.ARANJE_PRICE_TABLE);
  if (!priceTable) {
    problems.push({
      field: "ARANJE_PRICE_TABLE",
      reason:
        "surumlenebilir fiyat konfigurasyonu yok veya okunamiyor (spec 12.4)",
    });
  }

  const maxInputTokens = readInt(
    env,
    "ARANJE_MAX_INPUT_TOKENS",
    DEFAULT_MAX_INPUT_TOKENS,
    problems,
  );
  const maxOutputTokens = readInt(
    env,
    "ARANJE_MAX_OUTPUT_TOKENS",
    DEFAULT_MAX_OUTPUT_TOKENS,
    problems,
  );

  const modelDefault = env.ARANJE_MODEL_DEFAULT || DEFAULT_MODEL;
  const modelCheap = env.ARANJE_MODEL_CHEAP || DEFAULT_MODEL_CHEAP;
  const enableCheapRouting = readFlag(env, "ARANJE_ENABLE_CHEAP_ROUTING");
  const verifiedAt = env.ARANJE_CHEAP_MODEL_VERIFIED_AT;

  const config: CopilotConfig = {
    modelDefault,
    modelCheap,
    modelEscalation: env.ARANJE_MODEL_ESCALATION ?? "",
    enableCheapRouting,
    ...(verifiedAt ? { cheapModelVerifiedAt: verifiedAt } : {}),
    maxInputTokens,
    maxOutputTokens,
    dailyBudgetUsd: readNumber(
      env,
      "ARANJE_DAILY_AI_BUDGET_USD",
      DEFAULT_DAILY_BUDGET_USD,
      problems,
    ),
    monthlyBudgetUsd: readNumber(
      env,
      "ARANJE_MONTHLY_AI_BUDGET_USD",
      DEFAULT_MONTHLY_BUDGET_USD,
      problems,
    ),
    freePatchesPerUserPerDay: readInt(
      env,
      "ARANJE_FREE_PATCHES_PER_USER_PER_DAY",
      DEFAULT_FREE_PATCHES_PER_DAY,
      problems,
    ),
    priceTable: priceTable ?? { version: "unset", models: {} },
  };

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config };
}
