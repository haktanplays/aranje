# 2V-B.2c · Acceptance integrity correction

**What this round did:** made the acceptance harness unable to pass a step
that never happened, and unable to report a perception nobody supplied.

**What it did not do:** anything about physical audio, touch feel, pan,
phone-speaker distinction or musical quality. No claim of that kind appears
below, and the round's own report block no longer makes one either.

---

## 1 · Entry

| gate | measured |
| --- | --- |
| branch | `claude/proje-yorumları-n06wen` |
| HEAD at entry | `b039d9c` |
| `HEAD == @{u}` | yes |
| tree | clean |
| `a096686` ancestor | yes |
| `dc10969` ancestor | yes |
| `ef4291d` ancestor | yes |

No reset, rebase, amend, force-push, stash or discard. One forward commit.

## 2 · The defect, reproduced before it was fixed

`src/lib/acceptance/evidence-integrity.test.ts` was written first and run
against the starting tree. It failed 3 of 5, with exactly:

```
× extend passed with no action: expected true to be false
× extend/nothing_written present with no action: expected true to be false
× expected '10 · Sil, sonra geri al' to contain 'ileri al'
```

Those three lines are the whole round in miniature: a step passing on
arrival, a checklist claiming its evidence had arrived, and a step whose
title and gate disagreed.

## 3 · Root cause of the fresh-session false positive

`judgeBatchStep` had a branch that returned `passed` for the expectation kind
`no_write`:

```ts
case "no_write":
  return { passed: states.length === 1 && moved === 0, shortfalls: [...] };
```

`states.length === 1 && moved === 0` is the trace a step has **the instant it
opens** — one sampled state, revision unchanged. Eight of the thirteen steps
carried that expectation, so all eight were `passed` before the reader had
touched anything. `stepEvidence` had the mirror line, `present: trace.states.length <= 1`,
which is why the checklist showed `✓ Hiçbir şey yazılmadı` on a step nobody
had performed.

**The exact code path that treated the absence of a write as completion** was
therefore `batch-steps.ts :: judgeBatchStep` → the `no_write` case, and
`step-evidence.ts :: stepEvidence` → the `no_write` branch. Both are gone.
The expectation kind `no_write` no longer exists in the type, so the mistake
cannot be re-expressed without adding a member.

## 4 · What replaced it

Three new pure modules, and one rule.

**The rule (§2 rule 1):** the absence of a mutation is an *isolation
invariant*. It is still measured, still reported, and can never complete
anything.

| module | what it owns |
| --- | --- |
| `step-contract.ts` | One typed contract per step. Instruction, gate, checklist and report all read this and nothing else. |
| `production-witness.ts` | A pure reducer over readings of the product's own state. Turns "the end moved forward", "the playhead came round", "the tick did not move" into named facts. |
| `step-rows.ts` | The canonical row per step: evidence state, isolation state, human outcome. Every count and summary is a projection of these. |

The witness reads `window.__aranjeDebug`, the read-only measurement surface
that already existed and is armed only on `/eval/` routes, extended with one
more reading: the editor's held selection and how many listening verbs the
capability model is offering on it. **No acceptance-only mutation and no
acceptance branch was added to production editing or audio behaviour** (§2
rule 10) — nothing in the workspace, the engine or the command layer learns
that it is being watched.

## 5 · The canonical contract table

| # | step | contract | required evidence |
| --- | --- | --- | --- |
| 1 | Power chord seç, «Devam»a dokun | `selection_extended` | Bir seçim oluştu + Seçimin sonu ileri taşındı |
| 2 | Nota aralığı seç, «Daha fazla»yı aç | `actions_revealed` | Bir nota aralığı seçildi + «Seçimi dinle» ve «Seçimden döngü» göründü |
| 3 | Seçimi bir kez dinle | `auditioned` | Seçim çalmaya başladı + Seçimin sonunda durdu |
| 4 | Seçimden döngü | `looped` | Döngü başladı + başa döndü + kapatıldı |
| 5 | Duraklat, sonra devam et | `paused_resumed` | Çalma başladı + duraklatıldı + playhead yerinde kaldı + aynı yerden devam etti |
| 6 | Kopyala, yapıştır, geri al, ileri al | `redo_returns(paste)` | Yapıştırıldı + geri alındı + ileri alındı |
| 7 | Çoğalt | `redo_returns(duplicate)` | idem |
| 8 | Taşı | `redo_returns(move)` | idem |
| 9 | Tekrarla | `redo_returns(repeat)` | idem |
| 10 | **Sil, geri al, ileri al** | `redo_returns(delete)` | Silindi + geri alındı + ileri alındı |
| 11A | Bir enstrümanın satırını dinle | `listen_one_track` | Tek enstrümanla bir dinleme yapıldı |
| 11B | Ölçü başlığını dinle | `listen_all_tracks` | Birden fazla enstrümanla bir dinleme yapıldı |
| 12 | Sonuç | `survey_only` | eylem yok, yalnız soru |

`survey_only` is named rather than reached by omission, so a step with no
contract because nobody wrote one cannot be mistaken for one that is meant to
have none.

## 6 · Step 10, said the same way everywhere

| surface | before | after |
| --- | --- | --- |
| title | `10 · Sil, sonra geri al` | `10 · Sil, geri al, ileri al` |
| instruction | — | `Seçimi sil; ardından «Geri al», sonra «İleri al»a dokun.` |
| gate | required a redo | requires a redo, and says so |
| checklist | — | `«Sil» yapıldı` / `«Geri al» ile eski hâline dönüldü` / `«İleri al» ile değişiklik yeniden geldi` |
| result | `ölçüm: tek yazma + geri al bayt-eş` | derived from the contract above |

The three surfaces cannot drift apart again because there is one place the
requirement is written and the other three read it.

## 7 · The report, rebuilt from rows

Per step, three lines that cannot be collapsed into each other:

```
  3 · Seçimi bir kez dinle
    beklenen: Seçim çalmaya başladı + Seçimin sonunda durdu
    eylem kanıtı: gelmedi
    izolasyon: yazma yok
    cevap: cevaplanmadı (onceStart=—, onceScope=—, onceEnd=—)
```

`ölçüm: yazma yok → geçti` is gone from the codebase. The counts are
`Kanıtı gelmemiş adım` and `Hiç denenmemiş adım`, both computed from the
rows.

**11B hearing** is now derived from the answer alone: `Evet` → `evet`,
`Kısmen` → `kısmen`, `Hayır` → `HAYIR`, unanswered → `ölçülmedi`. The
technical fact is still printed, as `11B filtresi`, which is a claim about
which instruments were *planned* — a different sentence from which were
*heard*.

The block also checks itself. `reportInvariants` names
`valid_without_isolation`, `pass_with_unproven_step`,
`blocked_without_unreached_step`, `hearing_without_answer` and
`answer_without_hearing`; if any fires, the block prints
`Tutarsızlık: …` and tells the reader not to trust its own verdict.

## 8 · Retry and restart

`Tekrar dene` clears this step's trace, its accepted and refused events, and
its readings of the product. `Baştan başla` additionally clears the answers,
the ledger, the isolation record, the listening filters, the console errors,
the fingerprint chain **and the session's own name** — so a production event
still in flight from the abandoned run is refused as `wrong_session` rather
than satisfying a step of the new one.

## 9 · Verification

| gate | result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean, 8 routes |
| full suite | 284 files · 4678 tests, green ×4 consecutive |
| targeted (`src/lib/acceptance`, `src/lib/workspace`) | 524 tests, green ×20 consecutive |
| probes (`eval/editor-2vb2c/probes.sh`, run alone) | 14 red · 0 green |
| positive browser control (`eval/editor-2vb1/acceptance.mjs`) | 34/34 checks, 5 consecutive runs |
| negative browser control (`eval/editor-2vb2c/controls.mjs`) | 136/136 checks, 10 idle runs + restart |

### The positive control, in one line

All thirteen steps advanced. `Sonraki adım` is drawn disabled until the
production evidence and the answer are both in, so a run that walks thirteen
screens is a run in which every step really happened, in the editor, and was
really observed — and this one also came back byte-identical (`1 → 1`), wrote
nothing to the device's own store, and produced five atomic ledger rows with
byte-exact undo and redo.

### The negative control, in one line

Ten fresh sessions, nothing touched: `data-batch-evidence=missing`,
`Sonraki adım` disabled, every checklist line unticked, the gate reading
*Editörden henüz bu adıma ait kanıt gelmedi.*, `Kanıtı gelen adım: 0/13`.
Answering every question changes none of it. `Burada bitir` produces
`Verdict: BLOCKED`, thirteen rows saying `eylem kanıtı: denemedi`, no row
claiming `geldi`, `İkinci enstrüman duyuldu: ölçülmedi`, and no
`Tutarsızlık:` line.

### A repeatable negative control, by hand

```
eval/editor-2vb1/serve.sh
open http://127.0.0.1:3115/eval/editor-action-batch?sha=<short sha>
press "Teste dön"            # the question screen for step 1
```
Answer both questions "Evet" and try "Sonraki adım". It is disabled, the gate
says *Editörden henüz bu adıma ait kanıt gelmedi.*, and both checklist lines
are unticked. On `b039d9c` the same three presses read *Editör kanıtı geldi.*
and moved on.

## 10 · File budgets

| file | lines | budget |
| --- | --- | --- |
| `Workspace.tsx` | 377 | 377 |
| `ArrangementCanvas.tsx` | 470 | 470 |
| `TabCanvas.tsx` | 467 | 480 |

## 11 · What is still not claimed

Nothing here was heard. Every question about sound in the browser controls is
answered with a placeholder and the artifacts record that. The founder's ear
is the only thing that can close the acceptance round; this round only makes
sure that when they answer, the block beside their answer is true.
