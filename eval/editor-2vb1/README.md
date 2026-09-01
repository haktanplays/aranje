# `eval/editor-2vb1` — Faz 2V-B.1

The authority for the 2V-B.1 round: the founder's live Android FAIL reproduced,
the two full-screen acceptance states measured, the round walked end to end
through the real route, and every verification probed for its ability to go red.

Nothing here plays a sound anybody listened to. Everything here is a number.

## The scripts

| Script | What it answers |
|---|---|
| `serve.sh` | Serves the **built** app on `:3115`. The build sha is baked by `next.config.ts` at build time, so rebuild after every commit or the exact-sha gate refuses the link — correctly. |
| `reproduce.mjs` | The 2V-B FAIL on the build the founder was given (`26bd505`): the guide's height, the device store before/during/after, and the result block it produced. Kept unchanged as the *before* measurement. |
| `geometry.mjs` | §15. Both full-screen states across five contexts: overlay count, stolen production hit targets, hidden pointer owners, six strings, transport, drawer, overflow, 44 px, `Teste dön`, and — on the question screen — that the workspace is out of layout and out of hit testing. |
| `acceptance.mjs` | §17. The whole round on `384×692` with an Android UA: real long presses, real production controls, real transport. Its central claim is structural — "Sonraki adım" is drawn disabled until the production event arrives, so a run that walks all thirteen screens is a run in which every writing step really happened. |
| `probes.sh` | §16. Thirty-four mutations, each of which must make its verification red. `PROBE_BROWSER=1` adds the two that can only be measured in a browser. |
| `runs.sh` | §19. Ten consecutive targeted suites, ten consecutive browser acceptances, four whole suites — with the test counts recorded, so "ten times green" cannot be written over a command that matched nothing. |

## Running it

```bash
npm run build && eval/editor-2vb1/serve.sh
SHA=$(git rev-parse --short HEAD) node eval/editor-2vb1/geometry.mjs
SHA=$(git rev-parse --short HEAD) node eval/editor-2vb1/acceptance.mjs
eval/editor-2vb1/probes.sh              # PROBE_BROWSER=1 for all thirty-four
eval/editor-2vb1/runs.sh
```

## Artifacts

- `BASELINE.json` — the reproduction on `26bd505`. **348 px of 692** (50%).
- `GEOMETRY.json` — 130 checks, five contexts, and the old/new overlay numbers.
- `ACCEPTANCE.json` — the walk, the ledger rows, the isolation block, the two
  listening filters, and `browserEmulation: true` said in the artifact itself.
- `PROBES.json` — every mutation, whether it went red, and how many lines it
  touched.
- `RUNS.json` — the consecutive runs with their test counts.
- `geometry-*.png`, `acceptance-result.png` — what the screens looked like.

## What this cannot say

It cannot say how anything sounds. The acceptance runner answers the founder's
listening questions with a placeholder so the walk can continue, and the
artifact records that. A desktop Chromium with emulated touch is not a phone.
The round closes when Haktan runs the exact-sha route on the real device.
