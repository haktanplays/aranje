# 2V-B · Selection Action Canon

What is in here, and what each thing is evidence of.

## The live FAIL, and its confirmation

- `baseline.mjs` — the founder's own path on the build they were given:
  `/eval/selection-playback?sha=4d4deb3`, a real pointer selection, the real
  visible "Daha fazla". Written to be **red** on `4d4deb3`.
- `artifacts/BASELINE.json` — that red run. The sheet reads
  `["Kapat","Seçimi sil","Vazgeç","Uygula"]` and both listening actions render
  zero times.
- `artifacts/AFTER.json` — the same script on the fixed build (`OUT_NAME=AFTER`).
  The sheet reads `["Kapat","Yapıştır — Panoda bir şey yok.","Seçimi dinle","Seçimden döngü"]`.

The red artefact is kept. A green run never overwrites it.

## The two acceptance harnesses

Both take five contexts: `320×700`, `384×740 + Android UA`, `390×844`,
`412×915 + Android UA`, `1363×936 · touch=0`.

- `actions.mjs` — what each surface *draws*. Real gestures on the production
  DOM: long press and drag for a note range, long press on an arrangement cell
  for a run of bars, the visible door for every sheet. 17 checks per context.
- `functional.mjs` — what each action *does*. Every step is a cold start on
  the real route, and every claim is measured against the project record —
  its bytes and the revision the app bumps once per committed edit. 14 checks
  per context.

`runs.sh` runs both, ten times, and writes `artifacts/RUNS.json`. One red run
makes the series red however the other nine went.

## The audit nobody typed

`artifacts/REACHABILITY.json` is produced by
`src/lib/workspace/selection-reachability.test.ts`. Ten selection kinds ×
three modes × two clipboard states, with the capability, the rendered count,
the enabled state, the handler and the operation it reaches for — all
measured. `hiddenButAvailable`, `duplicateRenders` and
`renderedWithoutHandler` are counted, not claimed.

## Probes

`probes.sh` — 52 mutants. Each one is a way this round can be wrong that
somebody would actually write, and eleven of them simply remove one action
from the canon's placement, one at a time. Zero tests run, a timeout, or a
green mutant are all failures of the probe, not successes of the suite: they
are reported by name and never summed into the pass count.

## Running any of it

```sh
npm run build            # the founder routes carry the build's own sha
./eval/editor-2vb/serve.sh
node eval/editor-2vb/actions.mjs
node eval/editor-2vb/functional.mjs
./eval/editor-2vb/runs.sh
./eval/editor-2vb/probes.sh
```

`ONLY=384x740` limits a harness to one context. `SHA=<short>` pins the
baseline script's link.

## What none of this is

Evidence about sound. Every harness here runs headless Chromium and says so in
its own artefact: *browser emulation — not a physical device*. A `touch=0`
context can never be a physical PASS, and that is a rule in `batchVerdict`
rather than a note in a file.
