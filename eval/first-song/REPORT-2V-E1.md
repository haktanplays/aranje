# FAZ 2V-E.1 — FIRST SONG PRODUCT LOOP · teslim raporu

Branch `claude/proje-yorumları-n06wen`. Three forward commits from `1e372b0`:
`932ce0a`, `6ce85eb`, and this one.

---

## 1. What this round was, and what it was not

Turn the engine and editor work of B–D into **one reliable production loop**: a
real reader makes a song from nothing, sets it up, writes music, listens,
exports, closes the app and comes back to find it. Not a new editor-technique
round and not a Copilot round. No founder editor test and no listening was
asked for, and none is asked for now: no new audible engine behaviour appeared.

## 2. Entry gate — D.2 is closed

- `FOUNDER_AUTHORITY` carries thirty-five rows. L33, L34 and L35 are `pass`.
- **L31 stays `fail`**, with the founder's own sentence. A later card passing is
  not an appeal against an earlier refusal.
- `ACTIVE_CLIP_IDS` is `[]`. Nothing is in front of the reader between rounds.
- The D3/D4 tie-break is physically accepted.
- The blind onset detector's overlapping-note limit remains a **tool debt**,
  carried forward and not reopened here.

## 3. The finding that shaped c1: the app had no front door

One screen means the app has to open on *something*, and it opened on the demo
song — migrated into the reader's own library as `project-1`, taking the id
their first project would have had.

c1 built Home, stopped the migration on a genuinely empty device, added
`createFirstProject` with an allocated id, gave the session a write port before
there is a project, and added a save status.

## 4. The finding that shaped c2: it opened in the room with no doors

The first walk of track and section management reached **nothing** — zero rows,
zero controls, every step. The features were all there. A freshly created song
opened on **Düzen**, and the arrangement is the one surface that deliberately
carries neither the track control nor the section stepper.

`src/lib/workspace/opening-view.ts` fixes it: a song with nothing written in it
opens on the tab. The rule is about the music, not the moment.

## 5. The finding that shaped c3: a sheet opening under a sheet

The journey walk found "Projeler" opening the library **underneath** the song
menu, whose backdrop then swallowed every tap meant for it. The song menu was
also the one hand-rolled sheet in the app and the only one Escape did not
close. Both are fixed: it uses the shared `Sheet`, and the handoff closes
itself first.

## 6. Route inventory — walked, not read

`eval/first-song/ROUTE-INVENTORY.md`, two tables (c1 and c2). Every row was
reached by pressing what a reader presses. **An eval route's or a fixture's
capability is not counted as a product capability anywhere in it.**

## 7. The canonical journey — §25

`eval/first-song/journey.mjs`, **32 steps**, on the production route only.
Artefact: `artifacts/JOURNEY.json`.

**192/192 steps pass, on all six viewports, with 0 page errors and 0
horizontal overflows.**

| Viewport | Steps | Page errors | Overflows |
| --- | --- | --- | --- |
| 320×568 | 32/32 | 0 | 0 |
| 360×640 | 32/32 | 0 | 0 |
| 390×844 | 32/32 | 0 | 0 |
| 412×915 | 32/32 | 0 | 0 |
| 430×932 | 32/32 | 0 | 0 |
| 844×390 (landscape) | 32/32 | 0 | 0 |

The music is written through the real gesture chain — `Düzenle` → touch a slot
→ `Perde +` — not through a domain call from the harness.

## 8. Negative controls — §26

`eval/first-song/negative.mjs`, **9/9 held**. Artefact:
`artifacts/NEGATIVE-CONTROLS.json`. Two prove the harness can go red; seven
break something on purpose and require the app to refuse **in words**:

- "Son kalan bölüm silinemez."
- "Bölüm adı boş olamaz."
- "Bir bölüm 1 ile 8 arasında ölçü taşıyabilir."
- "Cihazda bu proje için yeterli kayıt alanı açılamadı. Mevcut projelerin
  değiştirilmedi."

A corrupt project is explained rather than shown as an empty song. A catalog
naming a project that is not there does not strand the reader. Storage that
refuses to be written **never produces a "Kaydedildi"**.

## 9. Performance — §27

`eval/first-song/performance.mjs` → `artifacts/PERFORMANCE.json`. Browser
figures only; a node timing is a different quantity and is not mixed in.

Fixture: **8 tracks · 8 sections · 64 bars · 4096 notes · 139.0 KiB**, built
through the app's own domain and written back through the key it reads.

| Step | p50 | p95 |
| --- | --- | --- |
| Cold load of the big song, to first notation | 771 ms | 864 ms |
| Switch to the arrangement | 485 ms | 559 ms |
| Switch to the multi view | 337 ms | 364 ms |
| Open the section manager on eight sections | 265 ms | 309 ms |
| Open the track manager on eight tracks | 284 ms | 322 ms |
| Go Home and back into the song | 602 ms | 692 ms |

7 samples each, `linux x64`. **No blind gate is set.** The first run of this
file reported every figure between 717 and 917 ms — the shape of a fixed
harness delay, not of six different amounts of work. The sleeps were taken out
of the sampled paths and the table above is what remained.

## 10. Probes — §31

`eval/first-song/probes.sh`, serial, hash-gated.

**60 RED · 0 STAYED-GREEN · 0 NO-TEST-MATCHED · 0 SETUP-FAIL · 0 RESTORE-FAIL.**

The pack's own most important result is about probes rather than about the app:

> `vitest -t` exits **0** when it matches no test. A probe aimed at a misspelled
> test name therefore reports as a *passing guard* — the exact failure these
> probes exist to catch, wearing the probes' uniform. The first run had
> **twenty-four** of them.

`NO-TEST-MATCHED` is now a separate result, and it is not counted as a pass.

**Six probes were removed rather than reported**, and each is named in the
script with its reason. Four aimed at the resize command's range check and
stayed green because `guardCandidate` refuses the same shapes one layer down —
a mutation two guards both catch cannot say which is holding. One aimed at a
type error `tsc` catches and vitest does not. One aimed at a migration step
name no test asserts.

**Three tests were strengthened rather than the probes softened**: the shrink
test now distinguishes which end was dropped, `numberedName` gained a case for
the leading anchor ("Solo Gitar 2"), and the navigation hook's use of
`openingView` is asserted on the source.

## 11. What c3 changed

| § | Change |
| --- | --- |
| §18 | The song menu moved onto the shared `Sheet` — Escape closes it, like every other sheet |
| §18 | "Projeler" closes the menu before opening the library |
| §21 | The header's ⓘ says "Şarkı menüsü: dışa aktar, yedekle, şarkı bilgileri" (c2) |

## 12. Test gates — §32

- `npx vitest run`: **357 files, 5830+ tests, 0 failures.**
- `npx tsc --noEmit`: clean.
- `npx eslint .`: clean.
- `npm run build`: clean.
- Component line budgets: **not raised, not loosened.** `Workspace.tsx` stays at
  377 against `intent-boundary`'s cap of 377.

## 13. Named and NOT done

The brief says: if it does not fit in three commits, do not ship half a project
flow — stop at a coherent boundary and write down what was not done, by name.
This is that list.

- **§17 the multi view** was walked and opens without losing the song. Its
  "smallest real role" was neither finished nor removed. It is unchanged.
- **§20 project rename** goes through "Şarkı bilgileri", which renames the
  song. There is no separate project-rename verb, and none was built.
- **§22 the one-time first-success moment** was not built. The save status says
  "Kaydedildi" on a real storage write, which is the honest half of it; the
  calm moment itself is not there.
- **§24 the storage ledger** exists only as the journey's own assertion (the
  run wrote 2 `aranje.` keys and 0 foreign keys). There is no ledger document.
- **§28 the visual contract** and **§30 accessibility** were checked only as
  far as the journey checks them: no horizontal overflow at any of six
  viewports, every control reached by its accessible marker, refusals carried
  in `role="alert"` regions. There is no contrast or focus-order audit.
- **§16 the arrangement overview** draws the song's shape and is otherwise
  unchanged.
- **`barsPerSection` stayed at 8.** Raising it to 64 with the song is a
  **measured contradiction**: the Copilot prompt's worst case is one densely
  written section and measures **8412 tokens** at 64 bars against a ceiling
  pinned at 8000 since K-32. Eight bars a section and sixty-four in a song is
  eight sections of eight. Whether to buy a longer section by re-measuring or
  narrowing the prompt is the founder's call, not this round's.
- **The track limit is 8, not 6.** The refusal behaviour the round asked for is
  present — it is a sentence, and the add control withdraws — but the number is
  the one already accepted in `songLimits`. Lowering it would invalidate songs
  that already exist.

## 14. What no automation here proves

Code and browser automation are **not** the founder's aesthetic or physical
acceptance. Every figure above was measured in Chromium on a Linux container.
Nothing in this round claims a phone, a pair of ears, or a reader's judgement.
