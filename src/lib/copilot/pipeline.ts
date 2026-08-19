/**
 * The /api/copilot pipeline (spec 11.4, 12.3).
 *
 * The order below is the whole safety argument, so it is written out once and
 * followed exactly:
 *
 *   parse request
 *     -> preflight limits          (input ceiling, anchor, song validity)
 *     -> idempotency lookup        (a replay costs nothing)
 *     -> reserve budget            (atomic, worst case, before any call)
 *     -> adapter                   (round 1, then at most 2 corrections)
 *     -> parse output              (strict; nothing unparsed is ever used)
 *     -> validate patch            (patchSize, before anything is applied)
 *     -> apply candidate in memory (pure; the canonical song is untouched)
 *     -> validate resulting Song   (the whole chain, on the candidate)
 *     -> settle budget             (down only, and only on verified usage)
 *     -> persist result            (idempotency record)
 *
 * Two notes where this differs from the shortest possible reading of the
 * brief, both of them forced by spec 12.3:
 *
 * 1. The idempotency lookup runs **before** the reservation. A replay must not
 *    cost anything, and it cannot be free if the money is taken first.
 * 2. Rounds two and three reuse the *same* reservation. Spec 12.3 reserves the
 *    worst case of "ilk üretim + en fazla 2 düzeltme turu" in one go, so a
 *    correction round is already paid for and must not reserve again.
 *
 * The canonical song is never written here. Spec 11.4/7: the user accepts, in
 * the client, and only then does the song change.
 */
import { CeilingError, withCeilings, type Adapter, type AdapterUsage } from "@/lib/ai/adapter";
import { selectRoute } from "@/lib/ai/routing";
import type { Clock } from "@/lib/budget/clock";
import { MAX_ROUNDS, requestCostMicros, worstCaseReservationMicros } from "@/lib/budget/cost";
import { stableHash } from "@/lib/budget/keys";
import { KvUnavailableError, type KvStore } from "@/lib/budget/kv";
import { priceFor, type ModelPrice } from "@/lib/budget/pricing";
import {
  markSpent,
  reconcileVerified,
  releaseLock,
  reserve,
} from "@/lib/budget/reservation";
import type { CopilotConfig } from "@/lib/config/copilot";
import { applyPatch } from "@/lib/copilot/apply";
import {
  anchorSectionId,
  copilotRequestSchema,
  expectedAction,
  modelPatchSchema,
  type CopilotPatch,
  type CopilotRequest,
  type CopilotSuccessBody,
} from "@/lib/copilot/contract";
import { checkPhase2EntryGate } from "@/lib/copilot/entry-gate";
import {
  failure,
  httpStatusFor,
  toResponseFailure,
  type CopilotErrorCode,
  type CopilotFailure,
  type ResponseFailure,
} from "@/lib/copilot/errors";
import { requestFingerprint } from "@/lib/copilot/fingerprint";
import * as idempotency from "@/lib/copilot/idempotency";
import { buildPrompt, type StyleCard } from "@/lib/copilot/prompt";
import { SONG_VALIDATORS, runValidators } from "@/lib/validators";
import { validatePatchSize, type PatchValidator } from "@/lib/validators/patchSize";
import {
  errorsOnly,
  warningsOnly,
  type ValidationIssue,
  type Validator,
} from "@/lib/validators/types";
import {
  emitMeteringEvent,
  latencyClassFor,
  type MeteringEvent,
  type MeteringSink,
} from "@/lib/metering/events";

export type PipelineDeps = {
  config: CopilotConfig;
  kv: KvStore;
  clock: Clock;
  adapter: Adapter;
  meter: MeteringSink;
  /** Server-generated ids (spec 11.1): never taken from the model. */
  newRequestId: () => string;
  newPatchId: () => string;
  /** Resolved by the caller; the pipeline reads no files. */
  styleCards?: Readonly<Record<string, StyleCard>>;
  timeoutMs?: number;
  /**
   * Injectable so a test can observe the order the two families run in. The
   * defaults are the real ones: `patchSize` judges the proposal before it is
   * applied, the song chain judges the candidate after.
   */
  patchValidators?: readonly PatchValidator[];
  songValidators?: readonly Validator[];
};

export type PipelineOutcome =
  | { ok: true; status: 200; body: CopilotSuccessBody }
  | { ok: false; status: number; body: ResponseFailure };

const DEFAULT_TIMEOUT_MS = 30_000;

function refuse(value: CopilotFailure): PipelineOutcome {
  return {
    ok: false,
    status: httpStatusFor(value.code),
    body: toResponseFailure(value),
  };
}

const ZERO_USAGE: AdapterUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function addUsage(a: AdapterUsage, b: AdapterUsage): AdapterUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Distinguish a bad song from a bad envelope, for a useful error code. */
function parseRequest(
  body: unknown,
): { ok: true; request: CopilotRequest } | { ok: false; code: CopilotErrorCode; diagnostic: string } {
  const parsed = copilotRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, request: parsed.data };

  // A song that is present but wrong is a song fault; a song that is missing
  // or is not an object at all is a malformed envelope.
  const touchesSong = parsed.error.issues.some(
    (issue) => issue.path[0] === "song" && issue.path.length > 1,
  );
  return {
    ok: false,
    code: touchesSong ? "song_invalid" : "invalid_request",
    diagnostic: parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
      .join("; "),
  };
}

type RoundFailure = { code: CopilotErrorCode; diagnostic: string; billed: boolean };

export async function runCopilot(
  deps: PipelineDeps,
  body: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<PipelineOutcome> {
  const startedAt = deps.clock.now();
  const requestId = deps.newRequestId();

  // --- gate ---------------------------------------------------------------
  // Spec 12.3 runs this at start-up too; running it per request means a
  // deployment whose environment drifted still fails closed.
  const gate = checkPhase2EntryGate(deps.config);
  if (!gate.ok) return refuse(failure(gate.code, gate.reasons.join(" | ")));

  // --- parse request ------------------------------------------------------
  const parsed = parseRequest(body);
  if (!parsed.ok) return refuse(failure(parsed.code, parsed.diagnostic));
  const request = parsed.request;

  // --- preflight ----------------------------------------------------------
  const anchorId = anchorSectionId(request);
  if (!request.song.sections.some((section) => section.id === anchorId)) {
    return refuse(failure("invalid_request", `anchor section ${anchorId} not in song`));
  }

  const styleCard = request.styleId
    ? deps.styleCards?.[request.styleId]
    : undefined;

  const firstPrompt = buildPrompt({ request, ...(styleCard ? { styleCard } : {}) });
  if (firstPrompt.estimatedInputTokens > deps.config.maxInputTokens) {
    // Before the provider, as spec 11.3 requires.
    return refuse(
      failure(
        "input_too_large",
        `${firstPrompt.estimatedInputTokens} > ${deps.config.maxInputTokens}`,
      ),
    );
  }

  const route = selectRoute("musical_patch", {
    modelDefault: deps.config.modelDefault,
    modelCheap: deps.config.modelCheap,
    enableCheapRouting: deps.config.enableCheapRouting,
    ...(deps.config.cheapModelVerifiedAt
      ? { cheapModelVerifiedAt: deps.config.cheapModelVerifiedAt }
      : {}),
  });

  const price = priceFor(deps.config.priceTable, route.model);
  if (!price) {
    return refuse(failure("config_missing", `no price for ${route.model}`));
  }

  const meterBase = {
    requestId,
    adapterRoute: route.route,
    adapterId: deps.adapter.id,
    model: route.model,
    priceTableVersion: deps.config.priceTable.version,
  };

  const emit = (event: Omit<MeteringEvent, keyof typeof meterBase>) => {
    emitMeteringEvent(deps.meter, { ...meterBase, ...event } as MeteringEvent);
  };

  try {
    return await withStore(deps, request, {
      requestId,
      model: route.model,
      price,
      firstPrompt,
      ...(styleCard ? { styleCard } : {}),
      startedAt,
      emit,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof KvUnavailableError) {
      // Spec 12.3: an unreachable counter store means "no", not "no limit".
      return refuse(failure("kv_unavailable", error.message));
    }
    throw error;
  }
}

type StoreContext = {
  requestId: string;
  /** Chosen by the router before any store work; the adapter never picks. */
  model: string;
  price: ModelPrice;
  firstPrompt: ReturnType<typeof buildPrompt>;
  styleCard?: StyleCard;
  startedAt: number;
  emit: (event: Omit<MeteringEvent, "requestId" | "adapterRoute" | "adapterId" | "model" | "priceTableVersion">) => void;
  signal?: AbortSignal;
};

async function withStore(
  deps: PipelineDeps,
  request: CopilotRequest,
  ctx: StoreContext,
): Promise<PipelineOutcome> {
  const subjectHash = await stableHash(request.subjectId);
  const keyHash = await stableHash(request.idempotencyKey);
  const fingerprint = await requestFingerprint(request);
  const idem = { kv: deps.kv };

  const latency = () => latencyClassFor(deps.clock.now() - ctx.startedAt);

  // --- idempotency --------------------------------------------------------
  const claimed = await idempotency.claim(idem, {
    subjectHash,
    keyHash,
    fingerprint,
    requestId: ctx.requestId,
  });

  if (claimed.outcome === "conflict") {
    ctx.emit({
      subjectHash,
      idempotency: "conflict",
      reservedMicros: 0,
      verifiedUsage: null,
      settledMicros: null,
      refundedMicros: 0,
      unverifiedReason: null,
      cache: "miss",
      rounds: 0,
      totalRoundCostMicros: 0,
      validation: "not_run",
      validationErrorCodes: [],
      latencyClass: latency(),
      outcome: "refused",
      errorCode: "idempotency_conflict",
    });
    return refuse(failure("idempotency_conflict", "same key, different payload"));
  }

  if (claimed.outcome === "in_flight") {
    // Only one of a duplicate pair may reach the provider (spec 12.4's
    // one-request-at-a-time rule, seen from the idempotency side).
    ctx.emit({
      subjectHash,
      idempotency: "in_flight",
      reservedMicros: 0,
      verifiedUsage: null,
      settledMicros: null,
      refundedMicros: 0,
      unverifiedReason: null,
      cache: "miss",
      rounds: 0,
      totalRoundCostMicros: 0,
      validation: "not_run",
      validationErrorCodes: [],
      latencyClass: latency(),
      outcome: "refused",
      errorCode: "concurrent_request",
    });
    return refuse(failure("concurrent_request", `held by ${claimed.requestId}`));
  }

  if (claimed.outcome === "replay") {
    const record = claimed.record;
    ctx.emit({
      subjectHash,
      idempotency: "replay",
      reservedMicros: 0,
      verifiedUsage: null,
      settledMicros: null,
      refundedMicros: 0,
      unverifiedReason: null,
      cache: "hit",
      rounds: 0,
      totalRoundCostMicros: 0,
      validation: "not_run",
      validationErrorCodes: [],
      latencyClass: latency(),
      outcome: record.state === "done" ? "success" : "failed",
      errorCode: record.state === "failed" ? record.code : null,
    });

    if (record.state === "done") {
      const cached = JSON.parse(record.response) as CopilotSuccessBody;
      return { ok: true, status: 200, body: { ...cached, cached: true } };
    }
    if (record.state === "failed") {
      // A call that may already have been billed is not re-run for free.
      return refuse(failure(record.code, "replayed failure"));
    }
  }

  // --- reserve ------------------------------------------------------------
  const reservedMicros = worstCaseReservationMicros(
    {
      maxInputTokens: deps.config.maxInputTokens,
      maxOutputTokens: deps.config.maxOutputTokens,
    },
    ctx.price,
  );

  const reservation = await reserve(
    {
      kv: deps.kv,
      clock: deps.clock,
      limits: {
        dailyBudgetUsd: deps.config.dailyBudgetUsd,
        monthlyBudgetUsd: deps.config.monthlyBudgetUsd,
        freePatchesPerUserPerDay: deps.config.freePatchesPerUserPerDay,
      },
    },
    { subjectHash, requestId: ctx.requestId, amountMicros: reservedMicros },
  );

  if (!reservation.ok) {
    // Nothing was called and nothing was billed, so the key stays reusable.
    await idempotency.release(idem, { subjectHash, keyHash, requestId: ctx.requestId });
    ctx.emit({
      subjectHash,
      idempotency: "fresh",
      reservedMicros: 0,
      verifiedUsage: null,
      settledMicros: null,
      refundedMicros: 0,
      unverifiedReason: null,
      cache: "miss",
      rounds: 0,
      totalRoundCostMicros: 0,
      validation: "not_run",
      validationErrorCodes: [],
      latencyClass: latency(),
      outcome: "refused",
      errorCode: reservation.code,
    });
    return refuse(failure(reservation.code, reservation.diagnostic));
  }

  const budgetDeps = {
    kv: deps.kv,
    clock: deps.clock,
    limits: {
      dailyBudgetUsd: deps.config.dailyBudgetUsd,
      monthlyBudgetUsd: deps.config.monthlyBudgetUsd,
      freePatchesPerUserPerDay: deps.config.freePatchesPerUserPerDay,
    },
  };

  try {
    return await runRounds(deps, request, ctx, {
      subjectHash,
      keyHash,
      fingerprint,
      reservedMicros,
      budgetDeps,
      latency,
    });
  } finally {
    await releaseLock(budgetDeps, subjectHash, ctx.requestId);
  }
}

type RoundsContext = {
  subjectHash: string;
  keyHash: string;
  fingerprint: string;
  reservedMicros: number;
  budgetDeps: Parameters<typeof reserve>[0];
  latency: () => ReturnType<typeof latencyClassFor>;
};

async function runRounds(
  deps: PipelineDeps,
  request: CopilotRequest,
  ctx: StoreContext,
  rounds: RoundsContext,
): Promise<PipelineOutcome> {
  const idem = { kv: deps.kv };
  const adapter = withCeilings(deps.adapter, {
    maxInputTokens: deps.config.maxInputTokens,
    maxOutputTokens: deps.config.maxOutputTokens,
  });

  let usageTotal: AdapterUsage = ZERO_USAGE;
  let usageVerified = true;
  let unverifiedReason: MeteringEvent["unverifiedReason"] = null;
  let costMicros = 0;
  let roundCount = 0;
  let corrections: string[] = [];
  let lastFailure: RoundFailure | null = null;

  const settle = async () => {
    if (usageVerified && roundCount > 0) {
      const outcome = await reconcileVerified(
        rounds.budgetDeps,
        ctx.requestId,
        costMicros,
      );
      return {
        settledMicros: outcome.ok ? (outcome.record.settledMicros ?? costMicros) : null,
        refundedMicros: outcome.ok ? outcome.refundedMicros : 0,
      };
    }
    // Spec 12.3: unverifiable means fully spent, and no window may release it.
    const outcome = await markSpent(
      rounds.budgetDeps,
      ctx.requestId,
      unverifiedReason ?? "provider_reported_no_usage",
    );
    return {
      settledMicros: outcome.ok ? (outcome.record.settledMicros ?? rounds.reservedMicros) : null,
      refundedMicros: 0,
    };
  };

  const finishFailed = async (
    failed: RoundFailure,
    validation: MeteringEvent["validation"],
    validationErrorCodes: string[],
  ): Promise<PipelineOutcome> => {
    const settled = await settle();
    // Recorded, so a retry with the same key does not buy a second free call.
    await idempotency.fail(idem, {
      subjectHash: rounds.subjectHash,
      keyHash: rounds.keyHash,
      fingerprint: rounds.fingerprint,
      requestId: ctx.requestId,
      code: failed.code,
      billed: failed.billed,
    });
    ctx.emit({
      subjectHash: rounds.subjectHash,
      idempotency: "fresh",
      reservedMicros: rounds.reservedMicros,
      verifiedUsage: usageVerified && roundCount > 0 ? usageTotal : null,
      settledMicros: settled.settledMicros,
      refundedMicros: settled.refundedMicros,
      unverifiedReason,
      cache: "miss",
      rounds: roundCount,
      totalRoundCostMicros: costMicros,
      validation,
      validationErrorCodes,
      latencyClass: rounds.latency(),
      outcome: "failed",
      errorCode: failed.code,
    });
    return refuse(failure(failed.code, failed.diagnostic));
  };

  for (let attempt = 0; attempt < MAX_ROUNDS; attempt += 1) {
    const prompt =
      attempt === 0
        ? ctx.firstPrompt
        : buildPrompt({
            request,
            ...(ctx.styleCard ? { styleCard: ctx.styleCard } : {}),
            corrections,
          });

    let result;
    try {
      result = await adapter.call({
        model: ctx.model,
        system: prompt.system,
        userMessage: prompt.userMessage,
        // The ceiling is a request parameter, not a request in the prompt.
        maxOutputTokens: deps.config.maxOutputTokens,
        estimatedInputTokens: prompt.estimatedInputTokens,
        timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
    } catch (error) {
      if (error instanceof CeilingError) {
        // A correction round grew the prompt past the ceiling. Nothing was
        // sent, but earlier rounds were, so the reservation still settles.
        return finishFailed(
          {
            code: "input_too_large",
            diagnostic: error.violation.kind,
            billed: roundCount > 0,
          },
          "not_run",
          [],
        );
      }
      throw error;
    }

    roundCount += 1;

    if (!result.ok) {
      const map: Record<typeof result.kind, { code: CopilotErrorCode; reason: MeteringEvent["unverifiedReason"] }> = {
        timeout: { code: "provider_timeout", reason: "provider_timeout" },
        network: { code: "provider_error", reason: "provider_network_error" },
        aborted: { code: "request_aborted", reason: "request_aborted" },
        provider_error: { code: "provider_error", reason: "provider_error" },
      };
      const mapped = map[result.kind];
      // The provider may have billed this; the reservation is spent in full.
      usageVerified = false;
      unverifiedReason = mapped.reason;
      return finishFailed(
        { code: mapped.code, diagnostic: result.diagnostic ?? result.kind, billed: true },
        "not_run",
        [],
      );
    }

    if (result.usage) {
      usageTotal = addUsage(usageTotal, result.usage);
      costMicros += requestCostMicros(result.usage, ctx.price);
    } else {
      usageVerified = false;
      unverifiedReason = "provider_reported_no_usage";
    }

    // --- parse output ----------------------------------------------------
    const patch = parseModelOutput(result.raw, request, deps.newPatchId);
    if (!patch.ok) {
      corrections = patch.corrections;
      lastFailure = {
        code: "provider_output_invalid",
        diagnostic: patch.diagnostic,
        billed: true,
      };
      continue;
    }

    // --- validate patch, before applying anything ------------------------
    const patchValidators = deps.patchValidators ?? [validatePatchSize];
    const sizeIssues = patchValidators.flatMap((validate) =>
      validate(request.song, patch.patch),
    );
    if (sizeIssues.length > 0) {
      corrections = sizeIssues.map((issue) => issue.message);
      lastFailure = {
        code: "patch_too_large",
        diagnostic: sizeIssues.map((issue) => issue.code).join(","),
        billed: true,
      };
      continue;
    }

    // --- apply in memory --------------------------------------------------
    const applied = applyPatch(request.song, patch.patch);
    if (!applied.ok) {
      corrections = ["Hedef bolum id'si sarkida bulunamadi."];
      lastFailure = {
        code: "provider_output_invalid",
        diagnostic: applied.reason,
        billed: true,
      };
      continue;
    }

    // --- validate the resulting song --------------------------------------
    const issues = runValidators(applied.song, deps.songValidators ?? SONG_VALIDATORS);
    const errors = errorsOnly(issues);
    if (errors.length > 0) {
      corrections = errors.map((issue) => issue.message);
      lastFailure = {
        code: "patch_invalid",
        diagnostic: errors.map((issue) => issue.code).join(","),
        billed: true,
      };
      continue;
    }

    // --- success ----------------------------------------------------------
    const warnings = warningsOnly(issues);
    const settled = await settle();
    const responseBody: CopilotSuccessBody = {
      requestId: ctx.requestId,
      patch: patch.patch,
      warnings,
      cached: false,
    };

    await idempotency.complete(idem, {
      subjectHash: rounds.subjectHash,
      keyHash: rounds.keyHash,
      fingerprint: rounds.fingerprint,
      requestId: ctx.requestId,
      response: JSON.stringify(responseBody),
    });

    ctx.emit({
      subjectHash: rounds.subjectHash,
      idempotency: "fresh",
      reservedMicros: rounds.reservedMicros,
      verifiedUsage: usageVerified ? usageTotal : null,
      settledMicros: settled.settledMicros,
      refundedMicros: settled.refundedMicros,
      unverifiedReason,
      cache: "miss",
      rounds: roundCount,
      totalRoundCostMicros: costMicros,
      validation: warnings.length > 0 ? "passed_with_warnings" : "passed",
      validationErrorCodes: [],
      latencyClass: rounds.latency(),
      outcome: "success",
      errorCode: null,
    });

    // The client may have gone away while the provider was answering. The
    // work is settled and cached either way, so the retry is free, but the
    // caller is told the truth about this attempt.
    if (ctx.signal?.aborted) {
      return refuse(failure("request_aborted", "client disconnected after success"));
    }

    return { ok: true, status: 200, body: responseBody };
  }

  const failed = lastFailure ?? {
    code: "internal_error" as const,
    diagnostic: "no rounds ran",
    billed: false,
  };
  return finishFailed(failed, "failed", [failed.code]);
}

type ParsedOutput =
  | { ok: true; patch: CopilotPatch }
  | { ok: false; diagnostic: string; corrections: string[] };

/**
 * Nothing the provider says is used before it has parsed. The patch id is
 * stamped here, on the server, because spec 11.1 does not let the model
 * choose one.
 */
function parseModelOutput(
  raw: string,
  request: CopilotRequest,
  newPatchId: () => string,
): ParsedOutput {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      diagnostic: "output was not JSON",
      corrections: ["Cikti gecerli JSON degildi. Yalnizca JSON uret."],
    };
  }

  const parsed = modelPatchSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
        .join("; "),
      corrections: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "kok"}: ${issue.message}`,
      ),
    };
  }

  const wanted = expectedAction(request);
  if (parsed.data.action !== wanted) {
    return {
      ok: false,
      diagnostic: `expected ${wanted}, got ${parsed.data.action}`,
      corrections: [`action alani ${wanted} olmali.`],
    };
  }

  const anchor = anchorSectionId(request);
  const given =
    parsed.data.action === "insert_section"
      ? parsed.data.afterSectionId
      : parsed.data.targetSectionId;
  if (given !== anchor) {
    return {
      ok: false,
      diagnostic: "patch anchored to a different section",
      corrections: [`Hedef bolum id'si ${anchor} olmali.`],
    };
  }

  return { ok: true, patch: { id: newPatchId(), ...parsed.data } };
}

export type { ValidationIssue };
