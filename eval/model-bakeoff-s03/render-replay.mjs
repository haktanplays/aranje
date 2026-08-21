/**
 * Render the 2H-B.1 replay to WAV.
 *
 * The song is the deterministic replay of candidate A's accepted blueprint
 * against the corrected materializer. Rendering it is how the fix stops being
 * a diff and starts being something you can hear: the acoustic close should
 * now be acoustic.
 *
 * `node eval/model-bakeoff-s03/render-replay.mjs`
 */
import { chromium } from "playwright";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

/*
 * The sample packs are fetched over HTTP by the audio layer, so a page loaded
 * from `about:blank` cannot reach them. A tiny static server for `public/` is
 * the whole fix; it serves the same files the app serves.
 */
const MIME = { ".json": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://x");
  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><meta charset=utf-8><title>replay</title><body></body>");
    return;
  }
  const path = join("public", normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});
await new Promise((resolve) => server.listen(0, resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const REPLAY = process.env.REPLAY_DIR ?? "eval/model-bakeoff-s03/artifacts/replay-2h-b1";
const OUT = `${REPLAY}/wav`;
mkdirSync(OUT, { recursive: true });

const bundle = readFileSync(".bakeoff-s03/bakeoff-render.js", "utf8");
const song = readFileSync(`${REPLAY}/song.json`, "utf8");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.error("page error:", message.text());
});
page.on("requestfailed", (request) => console.error("request failed:", request.url()));
page.on("response", (response) => {
  if (response.status() >= 400) console.error(`HTTP ${response.status()}: ${response.url()}`);
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });
await page.evaluate((raw) => window.aranjeBakeoffLoad("a", JSON.parse(raw)), song);

const metrics = [];
const ids = await page.evaluate(() => window.aranjeBakeoffCutIds());
console.log(`cuts: ${ids.length}`);

for (const id of ids) {
  const index = ids.indexOf(id);
  const result = await page.evaluate((i) => window.aranjeBakeoffRenderCut(i), index);
  const buffer = Buffer.from(result.wavBase64, "base64");
  const name = `${id.replace(/^candidate-a-/, "")}.wav`;
  writeFileSync(`${OUT}/${name}`, buffer);
  metrics.push({
    cut: name.replace(/\.wav$/, ""),
    seconds: Number(result.seconds.toFixed(2)),
    peak: Number(result.peak.toFixed(4)),
    rms: Number(result.rms.toFixed(5)),
    events: result.events,
    sampleRequests: result.sampleRequests,
  });
  console.log(`  ${name.padEnd(20)} ${(buffer.length / 1024).toFixed(0).padStart(5)} KB  ${result.seconds.toFixed(1)}s  peak ${result.peak.toFixed(3)}  ${result.events} events`);
}

writeFileSync(`${OUT}/../render-metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
await browser.close();
server.close();
