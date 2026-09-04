# 2V-C.2 · Expression fidelity

Four listening cards came back unhappy or unmeasurable. The rule this round
worked under was that no curve gets touched before the wrong thing is shown,
so this directory is the showing.

| file | what it is |
|---|---|
| `trace.ts` | Reads the **production** plan and writes down the moments that decide whether a gesture is a hand or an effect: when the pitch leaves, when it arrives, how long it sits, when it returns, and whether any of it happens outside the note. Asserts nothing. |
| `BEFORE.md` | What the shipped code did, in numbers. |
| `AFTER.md` | What it does now, against those numbers. |
| `panel-geometry.mjs` | The shelf's two new controls measured on the six viewports §17 names, in both states: choosing a distance, and coming back to remove what was written. |
| `probes.sh` | Twenty-one corruptions of this batch's fixes, each required to go red. Several are the shipped code as it stood before — would the suite have caught what the founder heard? |
| `artifacts/` | What those runs produced. |

## Running them

```
npm run build && bash eval/editor-2vb1/serve.sh        # the sha is baked at build time
SHA=$(git rev-parse --short HEAD) node eval/expression-fidelity/panel-geometry.mjs
bash eval/expression-fidelity/probes.sh                 # alone: it edits source in place
```

## What is deliberately not here

No claim about how anything sounds. Every number in `BEFORE.md` and
`AFTER.md` is a plan, an automation point or an event time, which is all a
test can honestly answer. Whether the bend now satisfies the ear is L17–L20's
question, and it is the founder's to answer.

The chain guard in `applyShiftSlides` is also not probed, on purpose: no
fixture reaches it, so removing it changes nothing today. It is defence in
depth against a note that is both a chain member and a shift-slide source,
and calling an unreachable branch "covered" is the kind of claim the probes
exist to prevent.
