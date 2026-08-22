/**
 * The browser-harness helpers every eval suite was carrying its own copy of
 * (2L-R). One body each, byte-for-byte the behaviour the suites already had:
 * same press timing, same reveal settle, same layout probe, same context
 * shape. Nothing here is product code and nothing in `src/` may import it.
 */

/** The phone-shaped context every suite opens. */
export async function mobileContext(browser, size) {
  return browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
}

/** Scroll an element into the middle of the view and let the scroll settle. */
export async function reveal(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, selector);
  await page.waitForTimeout(300);
}

/**
 * A real long press through CDP touch events.
 *
 * The trailing wait is longer than the app's own post-press click window
 * (400ms), because a finished press arms a one-shot click swallower and a
 * scripted click issued inside that window would be eaten.
 */
export async function press(page, cdp, selector, ms = 700) {
  await reveal(page, selector);
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box: ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(550);
}

/** Body overflow and every element that actually scrolls horizontally. */
export function layoutProbe(page) {
  return page.evaluate(() => {
    const scrollers = [...document.querySelectorAll("*")].filter(
      (node) =>
        node.scrollWidth > node.clientWidth + 1 &&
        ["auto", "scroll"].includes(getComputedStyle(node).overflowX),
    );
    return {
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      scrollers: scrollers.length,
    };
  });
}

/** The smaller edge of each selector's box, for 44px-target checks. */
export function targetEdges(page, selectors) {
  return page.evaluate((list) => {
    return list.map((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? Math.round(Math.min(box.width, box.height)) : 0;
    });
  }, selectors);
}

/**
 * Console and page errors, collected from the first line of the page's life.
 * Returns a getter, because the array only settles when the scenario asks.
 */
export function collectPageErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(String(error));
  });
  return () => [...errors];
}

/** PASS/FAIL accounting with a JSON artifact kept current after every line. */
export function makeRecorder(writeFileSync, outPath) {
  const results = [];
  const measurements = {};
  const flush = () =>
    writeFileSync(
      outPath,
      `${JSON.stringify(
        { results, measurements, failed: results.filter((e) => !e.pass).length },
        null,
        2,
      )}\n`,
    );
  const record = (name, pass, detail = "") => {
    results.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
    flush();
  };
  return { results, measurements, record, flush };
}
