import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A few pieces of copy carry a promise rather than a label, and losing one
 * would be a silent change of meaning: a demo that stops saying it is a demo,
 * or a candidate that stops saying it has not been saved. They are pinned
 * here so removing them is a failing test rather than a quiet edit.
 */
const ARRANGE_SHEET = readFileSync(
  "src/components/workspace/ArrangeSheet.tsx",
  "utf8",
);
const PREVIEW_SHEET = readFileSync(
  "src/components/workspace/PreviewSheet.tsx",
  "utf8",
);

describe("copy that is a promise, not a label", () => {
  it("labels the demo path as a demo, and says what it is not", () => {
    expect(ARRANGE_SHEET).toContain("Demo");
    expect(ARRANGE_SHEET).toContain("deterministik");
    expect(ARRANGE_SHEET).toContain("yapay zekâ üretmez");
  });

  it("shows the demo label only when the demo path is the one answering", () => {
    // The badge is behind the `demo` prop, so a provider session cannot show
    // it and a demo session cannot hide it.
    expect(ARRANGE_SHEET).toMatch(/\{demo \?/);
    expect(PREVIEW_SHEET).toMatch(/source === "demo"/);
  });

  it("says a candidate is not saved, in the heading and in the body", () => {
    expect(PREVIEW_SHEET).toContain("henüz kaydedilmedi");
    expect(PREVIEW_SHEET).toContain("aday");
    expect(PREVIEW_SHEET).toContain("şarkına yazılmaz");
  });

  it("does not rely on colour alone for the preview state", () => {
    // The heading, the badge and the button labels all say it in words.
    expect(PREVIEW_SHEET).toContain("Uygula");
    expect(PREVIEW_SHEET).toContain("Reddet");
    expect(PREVIEW_SHEET).toContain("Uyarılar — engellemez");
  });

  it("explains a locked surface refusal without naming internals", () => {
    const hook = readFileSync("src/lib/copilot/use-co-arranger.ts", "utf8");
    expect(hook).toContain("kilitli bir alanı değiştirmeye çalıştı");
  });
});
