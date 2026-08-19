import { describe, expect, it, vi } from "vitest";

import {
  DEMO_FLAG,
  createDemoClient,
  createProviderClient,
  isDemoEnabled,
  selectClient,
} from "@/lib/copilot/client";
import { buildCandidate, touchesOnlyTarget } from "@/lib/copilot/preview";
import { safeMessage } from "@/lib/copilot/errors";
import type { ArrangeSkill } from "@/lib/copilot/contract";
import type { Song } from "@/lib/song/schema";
import {
  HARMONY_SONG,
  TEST_SONG,
  arrangeRequest,
  mainSection,
} from "@/test/copilot-fixtures";

const SECTION_ID = mainSection().id;
const TARGETS: Readonly<Record<ArrangeSkill, string>> = {
  drums: "drums",
  bass: "bass",
  harmony: "gtr2",
};

function songFor(skill: ArrangeSkill): Song {
  return skill === "harmony" ? HARMONY_SONG : TEST_SONG;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("the demo path is chosen, never fallen back to", () => {
  it("is off unless the flag is literally true", () => {
    for (const value of [undefined, "", "false", "1", "TRUE", "yes"]) {
      const env = value === undefined ? {} : { [DEMO_FLAG]: value };
      expect(isDemoEnabled(env)).toBe(false);
      expect(selectClient(env, async () => jsonResponse(200, {})).source).toBe(
        "provider",
      );
    }
    expect(isDemoEnabled({ [DEMO_FLAG]: "true" })).toBe(true);
    expect(
      selectClient({ [DEMO_FLAG]: "true" }, async () => jsonResponse(200, {})).source,
    ).toBe("demo");
  });

  it("does not reach the demo when the provider refuses", async () => {
    const demo = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { code: "provider_unavailable", message: "x" }),
    );
    const client = createProviderClient(fetchImpl);

    const outcome = await client.arrange(arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.source).toBe("provider");
    expect(outcome.code).toBe("provider_unavailable");
    expect(demo).not.toHaveBeenCalled();
  });

  it("does not reach the demo when the network fails", async () => {
    const client = createProviderClient(async () => {
      throw new Error("offline");
    });
    const outcome = await client.arrange(arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.source).toBe("provider");
    expect(outcome.code).toBe("provider_error");
  });

  it("has no code path from a provider client to a demo answer", async () => {
    // Every outcome a provider client can produce is stamped "provider".
    const cases = [
      async () => jsonResponse(503, { code: "provider_unavailable" }),
      async () => jsonResponse(429, { code: "quota_exhausted" }),
      async () => jsonResponse(502, { code: "provider_output_invalid" }),
      async () => jsonResponse(200, {}),
      async () => {
        throw new Error("offline");
      },
    ];
    for (const fetchImpl of cases) {
      const outcome = await createProviderClient(fetchImpl).arrange(
        arrangeRequest("drums"),
      );
      expect(outcome.source).toBe("provider");
    }
  });
});

describe("the provider client shows only safe messages", () => {
  it("takes the message from our own table, not from the wire", async () => {
    const client = createProviderClient(async () =>
      jsonResponse(502, {
        code: "provider_error",
        message: "ECONNRESET key=sk-live-xyz at edge-7",
      }),
    );
    const outcome = await client.arrange(arrangeRequest("drums"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toBe(safeMessage("provider_error"));
    expect(outcome.message).not.toContain("sk-live");
    expect(outcome.message).not.toContain("ECONNRESET");
  });

  it("sends the request through the existing contract", async () => {
    const seen: { url: string; body: string }[] = [];
    const fetchImpl = async (
      url: string,
      init: { method: string; headers: Record<string, string>; body: string },
    ) => {
      seen.push({ url, body: init.body });
      return jsonResponse(200, { requestId: "r", patch: { id: "p" }, warnings: [] });
    };
    const request = arrangeRequest("drums");
    await createProviderClient(fetchImpl).arrange(request);

    expect(seen[0]?.url).toBe("/api/copilot");
    const sent = JSON.parse(seen[0]?.body ?? "{}") as Record<string, unknown>;
    expect(sent.operation).toBe("arrange_track");
    // The removed section-wide fields are not smuggled back in.
    for (const legacy of ["kind", "afterSectionId", "targetSectionId", "prompt"]) {
      expect(sent).not.toHaveProperty(legacy);
    }
  });
});

describe("the demo client obeys the same rules", () => {
  for (const skill of ["drums", "bass", "harmony"] as ArrangeSkill[]) {
    it(`${skill}: produces a candidate that touches only the target track`, async () => {
      const request = arrangeRequest(skill);
      const outcome = await createDemoClient(() => "demo-1").arrange(request);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.source).toBe("demo");

      const baseline = songFor(skill);
      const built = buildCandidate(baseline, request, outcome.patch);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(
        touchesOnlyTarget(baseline, built.candidate, SECTION_ID, TARGETS[skill]),
      ).toBe(true);
    });
  }

  it("stamps the id itself rather than taking one from the answer", async () => {
    const outcome = await createDemoClient(() => "demo-fixed").arrange(
      arrangeRequest("drums"),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.patch.id).toBe("demo-fixed");
  });

  it("refuses a mis-aimed request the same way the server does", async () => {
    const outcome = await createDemoClient().arrange(
      arrangeRequest("drums", { targetTrackId: "gtr" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("invalid_request");
  });

  it("gives the same answer every time", async () => {
    const client = createDemoClient(() => "demo-1");
    const first = await client.arrange(arrangeRequest("bass"));
    const second = await client.arrange(arrangeRequest("bass"));
    expect(first).toEqual(second);
  });

  it("makes no network call at all", async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(String(args[0]));
      throw new Error("the demo client must not reach the network");
    }) as typeof fetch;

    try {
      await createDemoClient().arrange(arrangeRequest("drums"));
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual([]);
  });
});
