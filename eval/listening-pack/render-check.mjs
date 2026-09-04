/**
 * Does every clip actually contain sound? (2W §5)
 *
 * The listening page renders through `Tone.Offline`, which needs a browser.
 * So the manifest — peak, RMS, duration, clipping, scope — is produced here,
 * by driving the real page and reading what it measured, rather than by a
 * unit test that would have to fake an audio context and would then be
 * measuring the fake.
 *
 * It also answers the two questions the founder must never be asked: did the
 * page write anything to the device's own storage, and did anything play
 * before it was asked to.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const checks = [];
let failures = 0;
const check = (name, pass, detail = "") => {
  checks.push({ name, pass, detail });
  if (!pass) failures += 1;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }

  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: { width: 384, height: 692 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: ANDROID,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  /* A reader who has already used the app: their own project is in the store. */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.setItem("aranje.sentinel", "the reader's own");
  });
  const storeBefore = await page.evaluate(() => JSON.stringify(window.localStorage));

  await page.goto(`${BASE}/eval/listening-pack?sha=${sha}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const header = await page.evaluate(() => ({
    sha: document.querySelector("[data-listen-sha]")?.textContent ?? "",
    fingerprint: document.querySelector("[data-listen-fingerprint]")?.textContent ?? "",
    clips: [...document.querySelectorAll("[data-listen-clip]")].map((node) =>
      node.getAttribute("data-listen-clip"),
    ),
    takes: [...document.querySelectorAll("[data-listen-take]")].map((node) =>
      node.getAttribute("data-listen-take"),
    ),
    attribution: document.querySelector("[data-listen-attribution]")?.getAttribute("href") ?? "",
    result: document.querySelector("[data-listen-result]")?.textContent ?? "",
  }));

  check("the page names the build it was opened for", header.sha === sha, header.sha);
  /*
   * Four since 2V-C.2, and exactly four (§2, §4).
   *
   * This check used to require ten, which was right when every card ever
   * built was on the surface. It is now the wrong question: L1-L16 are
   * answered, their results are the founder's and are kept in the archive,
   * and re-asking them is precisely what this batch removed. So the count is
   * of what the founder is being asked *this round*, and the number stays a
   * number rather than "some" so a fifth card cannot arrive unnoticed.
   */
  check("it offers four clips", header.clips.length === 4, header.clips.join(","));
  check(
    "every clip is one of this round's questions",
    header.clips.join(",") === "L17,L18,L19,L20",
    header.clips.join(","),
  );
  check("it credits the sample source", header.attribution.includes("http"), header.attribution);
  check(
    "nothing is answered before anyone answers",
    /* Only the round's own cards. The archive below the result carries the
       founder's real verdicts and is not "unanswered" — counting it here is
       the arithmetic the "13/16" defect was made of. */
    (
      header.result.slice(0, header.result.indexOf("Önceki turlar")).match(/ölçülmedi/g) ?? []
    ).length === 4,
    header.result.slice(0, 200),
  );
  check(
    "no editor gesture is asked for anywhere on the page",
    await page.evaluate(() => {
      /* The founder must not be asked to *do* anything in the editor.
         "Sonucu kopyala" is the page's own copy button, not an edit, so the
         search is for the gestures themselves. */
      const text = document.body.innerText.toLowerCase();
      return !["uzun bas", "yapıştır", "geri al", "ileri al", "sürükle", "seçimi kopyala"].some(
        (word) => text.includes(word),
      );
    }),
    "",
  );
  check(
    "nothing plays until it is asked to",
    await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-listen-state]")].every(
          (node) => node.getAttribute("data-listen-state") === "idle",
        ),
    ),
    "",
  );

  /* Render every take by pressing its own button, and read what it measured. */
  const manifest = [];
  for (const takeId of header.takes) {
    const started = Date.now();
    await page.locator(`[data-listen-take='${takeId}']`).click();
    await page
      .waitForFunction(
        (id) => {
          const node = document.querySelector(`[data-listen-take='${id}']`);
          const state = node?.getAttribute("data-listen-state");
          return state === "playing" || state === "ready" || state === "faulty" || state === "failed";
        },
        takeId,
        { timeout: 120000 },
      )
      .catch(() => {});
    const state = await page.evaluate(
      (id) => document.querySelector(`[data-listen-take='${id}']`)?.getAttribute("data-listen-state") ?? "",
      takeId,
    );
    const audit = await page.evaluate((id) => window.__aranjeListening?.[id] ?? null, takeId);
    manifest.push({ takeId, state, renderMs: Date.now() - started, audit });
    check(
      `${takeId} rendered and is playable`,
      state === "playing" || state === "ready",
      `${state}${audit ? ` peak=${audit.peak.toFixed(3)} rms=${audit.rms.toFixed(4)} s=${audit.seconds.toFixed(2)} clip=${audit.clipped}` : ""}`,
    );
    if (audit) {
      check(`${takeId} is not silent`, audit.silent === false, `peak=${audit.peak.toFixed(4)}`);
      check(`${takeId} does not clip`, audit.clipped === 0, `${audit.clipped}`);
      check(`${takeId} has no invalid samples`, audit.invalid === 0, `${audit.invalid}`);
    }
    /* Stop before the next one so the runs do not overlap. */
    await page.evaluate(() => {});
    await page.waitForTimeout(120);
  }

  const storeAfter = await page.evaluate(() => JSON.stringify(window.localStorage));
  check("the device's own store is byte-identical", storeBefore === storeAfter, "");
  check("console errors is 0", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  writeFileSync(
    `${OUT}MANIFEST.json`,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sha,
        fingerprint: header.fingerprint,
        passed: checks.length - failures,
        failed: failures,
        takes: manifest,
        checks,
      },
      null,
      2,
    )}\n`,
  );

  await page.screenshot({ path: `${OUT}listening-pack-384.png`, fullPage: true });
  await browser.close();
  console.log(`\n${checks.length - failures}/${checks.length} checks · ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
