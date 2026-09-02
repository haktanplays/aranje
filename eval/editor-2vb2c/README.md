# 2V-B.2c · Acceptance integrity

The round that made the acceptance harness tell the truth.

## What was wrong

On `b039d9c`, a fresh session of `/eval/editor-action-batch` reported
`Editör kanıtı geldi.` on step 1 before the reader had touched anything, and
did the same for seven more steps. Eight of the thirteen steps were expressed
as `no_write` and judged by "nothing was written" — which is true of a step
nobody has opened. Two presses of "Evet" then carried the round forward.

The report was contradictory in the same way: it correctly said
`Verdict: BLOCKED`, `11B filtresi: ölçülmedi` and eight steps unmeasured, and
in the same block said `İkinci enstrüman duyuldu: evet` — a perception nobody
had supplied, computed from the fixture having two tracks.

## What is here

| file | what it does |
| --- | --- |
| `probes.sh` | Fourteen corruptions of the evidence model, each required to go red. **Run alone** — it edits source in place. |
| `controls.mjs` | The negative browser control: ten runs that touch nothing and must pass nothing, plus the restart control. |
| `artifacts/PROBES.json` | What each probe measured. |
| `artifacts/CONTROLS.json` | Every check the negative control made. |

The **positive** browser control is `eval/editor-2vb1/acceptance.mjs`, which
performs all thirteen steps with real gestures on real production surfaces.
It is the pair to `controls.mjs`: one proves the gate opens for a reader who
did the work, the other proves it stays shut for one who did not.

```
eval/editor-2vb1/serve.sh
SHA=<short sha> node eval/editor-2vb1/acceptance.mjs   # positive, 34 checks
SHA=<short sha> node eval/editor-2vb2c/controls.mjs    # negative, 136 checks
eval/editor-2vb2c/probes.sh                            # 14 probes, serial
```

`serve.sh` serves whatever `npm run build` last produced, and the build bakes
the sha the route checks — so rebuild after every commit or the route will
refuse the link, correctly.
