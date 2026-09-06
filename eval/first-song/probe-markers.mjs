import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://127.0.0.1:3131";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const dump = async (label) => {
  const marks = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) if (a.name.startsWith("data-")) out.add(a.value ? `${a.name}=${a.value}` : a.name);
    }
    return [...out].sort();
  });
  console.log(`\n== ${label} (${marks.length})\n${marks.filter((m) => !m.startsWith("data-arr-") && !m.startsWith("data-cell") && !m.startsWith("data-build")).join("\n")}`);
};
const tap = async (sel, label) => {
  const n = await page.locator(sel).count();
  if (n === 0) { console.log(`\n!! ${label}: ${sel} absent`); return false; }
  await page.locator(sel).first().click();
  await page.waitForTimeout(500);
  return true;
};
await tap("[data-home-start]", "start");
await tap("[data-testid='view-tab']", "tab");
await dump("tab view");
if (await tap("[data-track-control]", "track door")) await dump("track sheet");
if (await tap("[data-track-manage]", "track manage")) await dump("track manager");
console.log("\nerrors:", errors.length, errors.slice(0, 3));
await browser.close();
