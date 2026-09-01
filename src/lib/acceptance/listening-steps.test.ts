/**
 * The eight steps, and what a run of them is allowed to claim (2V-A.1 §9, §10).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  ALL_LISTENING_QUESTIONS,
  LISTENING_STEPS,
  isHedged,
  listeningVerdict,
  type ListeningAnswers,
  type ListeningEnvironment,
} from "@/lib/acceptance/listening-steps";
import { formatListeningResult } from "@/lib/acceptance/listening-report";

const clean: ListeningEnvironment = {
  touchPoints: 5,
  consoleErrors: [],
  userStorageBefore: "{}",
  userStorageAfter: "{}",
};

/** Every question answered the way a working build would be heard. */
const allGood = (): ListeningAnswers =>
  Object.fromEntries(
    ALL_LISTENING_QUESTIONS.map((question) => [question.id, question.options[0]!]),
  );

describe("the guide a founder is handed", () => {
  it("is eight steps, no more", () => {
    expect(LISTENING_STEPS.length).toBeLessThanOrEqual(8);
    expect(LISTENING_STEPS.length).toBe(8);
  });

  it("gives each screen exactly one task", () => {
    for (const step of LISTENING_STEPS) {
      expect(step.task.length, step.id).toBeGreaterThan(0);
      /* One sentence, one thing to do: no step smuggles in a second. */
      expect(step.task.split("Sonra").length, step.id).toBe(1);
    }
  });

  it("asks nothing in the app's own vocabulary", () => {
    const words = /tick|slot|descriptor|scope\b|scheduler|schema|validator|commit/i;
    for (const step of LISTENING_STEPS) {
      expect(step.task, step.id).not.toMatch(words);
      expect(step.listenFor, step.id).not.toMatch(words);
      for (const question of step.questions) {
        expect(question.prompt, question.id).not.toMatch(words);
      }
    }
  });

  it("covers the eight things §8 asks for", () => {
    expect(LISTENING_STEPS.map((step) => step.id)).toEqual([
      "select",
      "audition",
      "loop",
      "pause",
      "cancel",
      "trackScope",
      "allScope",
      "finish",
    ]);
  });

  it("asks the loop the three questions that matter", () => {
    const loop = LISTENING_STEPS.find((step) => step.id === "loop");
    expect(loop?.questions.map((question) => question.id)).toEqual([
      "loopGap",
      "loopDoubleAttack",
      "loopTempo",
    ]);
  });
});

describe("what a run may claim", () => {
  it("passes on a real device with everything answered well", () => {
    expect(listeningVerdict(clean, allGood())).toBe("PASS");
  });

  it("can never pass in a touch=0 environment", () => {
    /* The whole reason this round exists: four green desktop viewports did
       not find what one phone found in a minute. */
    expect(listeningVerdict({ ...clean, touchPoints: 0 }, allGood())).toBe("PARTIAL");
  });

  it("fails when a founder says the music did the wrong thing", () => {
    for (const [id, bad] of [
      ["auditionStart", "Hayır"],
      ["auditionScope", "Hayır"],
      ["auditionEnd", "Hayır"],
      ["loopGap", "Var"],
      ["loopDoubleAttack", "Evet"],
      ["loopTempo", "Kaydı"],
      ["pauseResumed", "Hayır"],
      ["pauseSingleVoice", "Evet"],
      ["cancelStopped", "Hayır"],
      ["cancelClean", "Kaldı"],
      ["trackScopeOnly", "Hayır"],
      ["allScopeTogether", "Hayır"],
    ] as const) {
      expect(listeningVerdict(clean, { ...allGood(), [id]: bad }), id).toBe("FAIL");
    }
  });

  it("is partial while any question is unanswered", () => {
    const answers = { ...allGood(), auditionEnd: null };
    expect(listeningVerdict(clean, answers)).toBe("PARTIAL");
  });

  it("fails if the reader's own project moved, whatever they heard", () => {
    expect(
      listeningVerdict(
        { ...clean, userStorageAfter: '{"aranje.project.1":"x"}' },
        allGood(),
      ),
    ).toBe("FAIL");
  });

  it("fails if the app wrote to the console", () => {
    expect(listeningVerdict({ ...clean, consoleErrors: ["boom"] }, allGood())).toBe(
      "FAIL",
    );
  });

  it("does not treat a hedge as a break", () => {
    /* "Kısmen" is a finding, not a fault: it leaves the run unfinished. */
    const answers = { ...allGood(), auditionScope: "Kısmen" };
    expect(listeningVerdict(clean, answers)).toBe("PASS");
    expect(isHedged("Kısmen")).toBe(true);
    expect(isHedged("Evet")).toBe(false);
  });
});

describe("the block that comes back", () => {
  const device = {
    date: "2026-09-01",
    viewport: "384×740",
    platform: "Linux armv8l",
    touchPoints: 5,
    userAgent: "Mozilla/5.0 (Linux; Android 14)",
  };

  const block = (over: Partial<Parameters<typeof formatListeningResult>[0]> = {}) =>
    formatListeningResult({
      buildSha: "abcdef1234567890",
      device,
      environment: clean,
      answers: allGood(),
      note: "",
      ...over,
    });

  it("carries every row §9 names", () => {
    const text = block();
    for (const row of [
      "Build:",
      "Ekran:",
      "Dokunma noktası:",
      "Ortam:",
      "Functional",
      "Listening",
      "Tek dinleme",
      "Üç loop turu",
      "Duraklat/devam",
      "İptal temizliği",
      "Tek enstrüman kapsamı",
      "Tüm enstrüman kapsamı",
      "Kullanıcı notu:",
      "Verdict:",
    ]) {
      expect(text, row).toContain(row);
    }
  });

  it("names a desktop as one, and refuses to call it physical", () => {
    const text = block({
      device: { ...device, touchPoints: 0 },
      environment: { ...clean, touchPoints: 0 },
    });
    expect(text).toContain("dokunma 0");
    expect(text).toContain("fiziksel cihaz kanıtı değildir");
    expect(text).toContain("Verdict: PARTIAL");
    expect(text).not.toContain("Verdict: PASS");
  });

  it("says PASS on a device where everything was heard and answered", () => {
    expect(block()).toContain("Verdict: PASS");
  });

  it("makes no claim about how any of it sounded", () => {
    const text = block().toLowerCase();
    for (const word of ["organik", "kalite", "daha iyi", "daha güzel", "zengin"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("counts what is missing rather than rounding it away", () => {
    const text = block({ answers: { ...allGood(), loopTempo: null } });
    expect(text).toContain("Cevaplanmamış soru: 1");
    expect(text).toContain("loopTempo=—");
  });
});

describe("the route this guide belongs to", () => {
  const page = readFileSync("src/app/eval/selection-playback/page.tsx", "utf8");

  it("is told not to be indexed", () => {
    expect(page).toContain("robots");
    expect(page).toContain("index: false");
  });

  it("is not linked from the product", () => {
    expect(readFileSync("src/app/page.tsx", "utf8")).not.toContain("selection-playback");
  });
});
