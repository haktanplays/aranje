# Hearing a selection — 2V-A acceptance

Three things live here, and each answers a different question.

## `verify.mjs` — did the production surface do it?

Four contexts (`320×700`, `390×844`, `412×915` with an Android user-agent,
`1363×936` with no touch), twenty checks each, driven through the controls a
reader presses on the guided acceptance route. It starts nothing itself: the
audition begins because "Seçimi dinle" was pressed, and ends because the app
decided it had.

```
npx next start -p 3114        # a build, not a dev server
node eval/editor-2va/verify.mjs
ONLY=390x844 node eval/editor-2va/verify.mjs   # one context
```

Results land in `artifacts/RESULTS.json`, labelled
`"browser emulation — not a physical device"`. **A run of this is never a
physical pass.** Chromium with a touch context is enough for the pointer path,
the transport and the audio graph; it is not a phone, and no line of the
report may say otherwise.

Two instruments it uses, and why neither is the obvious one:

- **`window.__aranjeDebug.selection()`** for where a run started and ended.
  The screen cannot answer that — the drawer closes when playback starts, and
  the band on the staff marks the selection rather than the sound.
- **`window.__aranjeAcceptance`** for the stored Song's bytes and the project
  record's revision. Wrapping `localStorage.setItem` to count writes would
  read zero whatever the app did, because this route's storage is a `Map` the
  page owns. Step 15 makes one real edit and requires all three readings to
  move, so every zero above it is a measured zero rather than a structural one.

## `probes.sh` — would any of it have noticed?

Thirty-two mutants, each a way this feature can be wrong that somebody would
actually write, and each required to turn a **named** test red. Green is
reported as VACUOUS and listed; a run that asserted nothing, or timed out, is
INVALID and never counted as a finding.

```
./eval/editor-2va/probes.sh
PROBE_TIMEOUT=240 ./eval/editor-2va/probes.sh   # a slower machine
```

Two mutants were retired as equivalent rather than left green — the reasoning
is in the file, above probe 10.

## `honesty.test.ts` — is the harness telling the truth?

It runs in the ordinary suite. It guards the prose and the shape of the steps:
that the results are labelled an emulation, that the scroll walk names where
it stops, that the vacuity control for the zero-write claims is still there,
and that nothing here claims anything about how the music sounded.

Nobody has listened to this round. That is a separate step and it has not
been done.
