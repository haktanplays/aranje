# Technique spans — measured evidence (2V-D.1-C)

Three artefacts, three different questions. None of them is prose.

## `pm-timeline.test.ts` — where a palm mute's length comes from

Runs in the ordinary suite. It prints the whole timeline for a legacy
`articulation: palm_mute`, an equivalent `techniqueSpan`, and a plain note:
written ticks, gated ticks, planned seconds, filter and envelope. Its header
records the **first** reading verbatim, before the fix, because the round
before this one described the 8 ms gap as a rounding and it was not one — the
timeline gated the legacy mute in ticks, could not see a span, and the planner
then gated the span a second time.

    npx vitest run eval/technique-spans/pm-timeline.test.ts --disable-console-intercept

## `measure.mjs` → `MEASUREMENTS.json`, `wav/` — the same thing, in air

A real offline render through `createEngine` + `scheduleSong`, the same path
the WAV export uses. Three fixtures: `legacy`, `span`, and `plain` as the
control — two identical muted renders would otherwise also be consistent with
a harness that muted everything, or nothing.

    npx vite build --config eval/technique-spans/vite.spans.config.mts
    MEASURE_COMMIT=$(git rev-parse --short HEAD) node eval/technique-spans/measure.mjs

`verdicts` in the artefact are the three claims, decided by the numbers:
`spanIsAudible`, `spanMatchesLegacy`, and `muteChangesTheSound` (the control).
`src/lib/export/span-export.test.ts` reads them back, so a stale file fails.

## `measure-perf.ts` → `PERFORMANCE.json` — what density costs

Span count per section at 1×, 4× and 8× over identical music, timing the index,
the timeline, the plan, an edit and the settle gate separately. **Node on a
desktop**, not a phone: what carries over to a device is whether the numbers
stay flat with density, not the milliseconds.

    MEASURE_COMMIT=$(git rev-parse --short HEAD) npx tsx eval/technique-spans/measure-perf.ts

8× is the ceiling the Song Contract itself imposes — a section may hold at most
`songLimits.barsPerSection` (eight) spans — so a denser song cannot currently be
written. That limit is recorded in the artefact rather than worked around.
