/**
 * POST /api/copilot (spec 11.4).
 *
 * A route handler only: it reads the request, hands it to the pipeline and
 * turns the pipeline's answer into an HTTP response. Every decision — limits,
 * budget, validation, idempotency — lives in the pipeline, where it can be
 * tested without a server.
 *
 * This file runs on the server only. The configuration it reads is backend
 * environment (spec 12.1) and nothing it touches is exported to a client
 * component, so no key or budget figure can reach the browser bundle.
 *
 * No provider is wired in this build. `resolveRuntime` says so, and the route
 * refuses with a stable code rather than pretending.
 */
import { loadCopilotConfig } from "@/lib/config/copilot";
import {
  failure,
  httpStatusFor,
  toResponseFailure,
} from "@/lib/copilot/errors";
import { runCopilot } from "@/lib/copilot/pipeline";
import { resolveRuntime } from "@/lib/copilot/runtime";

export const dynamic = "force-dynamic";

function refuse(code: Parameters<typeof failure>[0], diagnostic: string) {
  // The diagnostic stays here, on the server, and is not serialised.
  void diagnostic;
  return Response.json(toResponseFailure(failure(code)), {
    status: httpStatusFor(code),
  });
}

export async function POST(request: Request): Promise<Response> {
  const config = loadCopilotConfig(process.env);
  if (!config.ok) {
    return refuse(
      "config_missing",
      config.problems.map((problem) => problem.field).join(","),
    );
  }

  const runtime = resolveRuntime();
  if (!runtime.ok) return refuse(runtime.code, runtime.diagnostic);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("invalid_request", "body was not JSON");
  }

  const outcome = await runCopilot(
    {
      config: config.config,
      kv: runtime.runtime.kv,
      clock: runtime.runtime.clock,
      adapter: runtime.runtime.adapter,
      meter: () => {},
      newRequestId: () => crypto.randomUUID(),
      newPatchId: () => crypto.randomUUID(),
    },
    body,
    { signal: request.signal },
  );

  return Response.json(outcome.body, { status: outcome.status });
}
