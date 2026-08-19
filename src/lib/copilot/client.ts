/**
 * The screen's one way to ask for an arrangement.
 *
 * The UI talks to this and to nothing below it: no adapter, no pipeline, no
 * pricing, no counter store. That keeps every server-only concern out of the
 * browser bundle and leaves exactly two ways an answer can arrive.
 *
 * **The provider path** posts to `/api/copilot`. In this build no provider is
 * wired, so the route refuses with a stable code and the client shows the safe
 * message for it. It does not retry somewhere else.
 *
 * **The demo path** is a deterministic stand-in, and it is *chosen*, never
 * fallen back to. A provider failure that quietly became a fake success would
 * be the worst possible bug here: it would look like the product works. So the
 * two clients are picked once, up front, from an explicit flag, and neither
 * knows the other exists.
 *
 * The demo path is not a second, looser implementation of the rules. It builds
 * an answer and then hands it to the same `parseArrangePatch` the server uses;
 * everything after that — scope, size, apply, locked surface, the validator
 * chain — belongs to the preview machine and runs identically for both paths.
 * It also runs no budget and no metering, and does not pretend to: a demo that
 * counted quota would be lying about a cost nobody paid.
 */
import { arrangeAnswer } from "@/lib/ai/fake-skills";
import { parseArrangePatch, resolveTarget } from "@/lib/copilot/arrange";
import type { CopilotPatch, CopilotRequest } from "@/lib/copilot/contract";
import {
  safeMessage,
  type CopilotErrorCode,
  type ResponseFailure,
} from "@/lib/copilot/errors";

export type CoArrangerSource = "provider" | "demo";

export type CoArrangerOutcome =
  | { ok: true; patch: CopilotPatch; warnings: unknown[]; source: CoArrangerSource }
  | {
      ok: false;
      code: CopilotErrorCode;
      /** Already safe to show. Provider wording never reaches here. */
      message: string;
      source: CoArrangerSource;
    };

export type CoArrangerClient = {
  readonly source: CoArrangerSource;
  arrange(
    request: CopilotRequest,
    options?: { signal?: AbortSignal },
  ): Promise<CoArrangerOutcome>;
};

export const DEMO_FLAG = "NEXT_PUBLIC_ARANJE_COPILOT_DEMO";

/** Off unless the flag is literally "true". Nothing else enables it. */
export function isDemoEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env[DEMO_FLAG] === "true";
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createProviderClient(
  fetchImpl: FetchLike,
  endpoint = "/api/copilot",
): CoArrangerClient {
  return {
    source: "provider",
    async arrange(request, options = {}) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch {
        // The network, not the model. There is no second place to ask.
        return {
          ok: false,
          code: "provider_error",
          message: safeMessage("provider_error"),
          source: "provider",
        };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return {
          ok: false,
          code: "internal_error",
          message: safeMessage("internal_error"),
          source: "provider",
        };
      }

      if (!response.ok) {
        const failure = body as Partial<ResponseFailure>;
        const code = (failure.code ?? "internal_error") as CopilotErrorCode;
        // The message is taken from our own table, not from the wire, so a
        // route that ever leaked provider text could not pass it through here.
        return { ok: false, code, message: safeMessage(code), source: "provider" };
      }

      const success = body as { patch?: CopilotPatch; warnings?: unknown[] };
      if (!success.patch) {
        return {
          ok: false,
          code: "provider_output_invalid",
          message: safeMessage("provider_output_invalid"),
          source: "provider",
        };
      }

      return {
        ok: true,
        patch: success.patch,
        warnings: success.warnings ?? [],
        source: "provider",
      };
    },
  };
}

/**
 * The deterministic demo. It answers from the same fake skills the tests use,
 * through the same parser the server uses.
 */
export function createDemoClient(
  newPatchId: () => string = () => `demo-${Math.random().toString(36).slice(2, 10)}`,
): CoArrangerClient {
  return {
    source: "demo",
    async arrange(request) {
      const resolved = resolveTarget(request);
      if (!resolved.ok) {
        return {
          ok: false,
          code: "invalid_request",
          message: safeMessage("invalid_request"),
          source: "demo",
        };
      }

      const raw = arrangeAnswer({
        song: request.song,
        section: resolved.section,
        target: resolved.track,
        skill: request.skill,
        sectionId: request.sectionId,
      });

      const parsed = parseArrangePatch(raw, request, newPatchId);
      if (!parsed.ok) {
        return {
          ok: false,
          code: "provider_output_invalid",
          message: safeMessage("provider_output_invalid"),
          source: "demo",
        };
      }

      return { ok: true, patch: parsed.patch, warnings: [], source: "demo" };
    },
  };
}

/**
 * Pick one client, once. There is deliberately no path from a provider failure
 * to the demo client: the choice is made before any request is sent.
 */
export function selectClient(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: FetchLike,
): CoArrangerClient {
  return isDemoEnabled(env)
    ? createDemoClient()
    : createProviderClient(fetchImpl);
}
