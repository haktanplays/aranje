# The live "Devam" FAIL, and the real listening route — 2V-A.1

## What happened

A founder on a real Android phone, `384×740`, five touch points, opened
`/eval/editor-acceptance?sha=057f405`. The guide said «2/36 · «Devam»a
dokun.». The selection read «1 power chord · 3 nota». The buttons on screen
were `Kopyala · Kes · Çoğalt · Tekrarla · Taşı · Sil · Daha fazla`.

Seven of them, and no "Devam".

The capability model had been offering `extend` all along and the compact
toolbar had drawn it since K-59. Neither was on screen: that seven-verb list
is `SelectionActionBar`, the bar the **reading** surface draws, and it never
asked the model anything. The compact row only exists once "Düzenle" has been
pressed, and the guide does not ask for that.

## `devam.mjs` — the regression, on five screens

Five contexts (`320×700`, `384×740` + Android UA, `390×844`, `412×915` +
Android UA, `1363×936` with no touch), fourteen checks each, on the
production route through the production controls.

```
npx next start -p 3114
node eval/editor-2va1/devam.mjs
ONLY=384x740 node eval/editor-2va1/devam.mjs   # the founder's own screen
```

Against a build with the eighth entry removed it reports **10/14 with steps
4, 5, 6 and 7 red** — the live FAIL, in a file.

It will not accept finding the word as a pass. Step 7 measures the band the
app draws: wider than it was, **and with its left edge unmoved**, so a
selection that grew by sliding sideways is a different gesture wearing this
one's result. Step 8 reads the page's own recorded verdict rather than the
step counter, which advances whether a phase passed or failed.

## `listening.mjs` — the 2V-A founder route

`/eval/selection-playback` is the listening test. The editor route is not,
and reporting its result as a listening result is how a round gets accepted
without anyone having heard anything.

```
node eval/editor-2va1/listening.mjs
```

Fourteen checks per context: all eight steps reachable, each naming a shipped
control, no step speaking the app's vocabulary, every answer a 44px target
with an unclipped name, the block carrying every row, a link for another
build refused, the right link accepted, and a sentinel in the reader's own
storage intact after a whole run.

**A `touch=0` context can reach PARTIAL and no further**, however cleanly
every step ran, and step 9 checks exactly that. Four green desktop viewports
did not find what one phone found in a minute.

## `probes.sh` — would any of it have noticed?

Thirty-two mutants, each required to turn a **named** test red. Green is
reported as VACUOUS and listed; a run that asserted nothing, or timed out, is
INVALID and never counted as a finding.

```
./eval/editor-2va1/probes.sh
PROBE_TIMEOUT=300 ./eval/editor-2va1/probes.sh
```

Two of them found real gaps in my own tests on the first pass — nothing
proved the reach moves the *far* edge (a file-wide search for
`moveEdge("end", …)` stayed green with the armed branch moving the near one),
and nothing pinned where the guide reads the arm from. Both are tests now.

## What none of this is

Nobody has listened to any of it. The listening is the founder's, on a real
device, through `/eval/selection-playback`, and the block it produces says
which kind of environment answered.
