"use client";

/**
 * One acceptance session, two full-screen states (2V-B.1 §11).
 *
 * ## The defect this replaces
 *
 * The previous version put the guide in a panel under the workspace. On the
 * founder's phone that panel measured **348 px of a 692 px viewport** — half
 * the screen — and the run failed on six of twelve steps. The diagnosis was
 * one cause with six symptoms: a workspace squeezed into 344 px is a
 * workspace you cannot select notes in, so the founder did the work
 * somewhere else, and every step's trace came back single-state.
 *
 * A popup is not a smaller version of the right answer. The reader is either
 * playing with the song or answering a question about it, and those are two
 * whole screens:
 *
 * - **Song.** The production workspace, full height, with nothing over it.
 *   No question, no answer list, no sheet, no invisible acceptance layer. The
 *   only thing this route adds is a thin normal-flow strip carrying the
 *   session line and one control labelled exactly "Teste dön". It is in the
 *   flex column, not on top of it, so it cannot overlap a production target
 *   or own a pointer that belongs to the staff.
 * - **Task.** The one current question and its answers, and "Şarkıya geç".
 *   The workspace is `hidden` — out of layout, out of hit testing, out of
 *   pointer ownership — rather than unmounted, because §11 also asks that
 *   coming back lands on the *same live task state*, and a remount would
 *   throw away the selection and rebuild the audio engine every time the
 *   reader looked at a question.
 *
 * ## What completes a step
 *
 * Not this component. A step that changes the music is completed by a
 * production workspace event; "Sonraki adım" is drawn disabled until that
 * event has arrived and the question has been answered, and the screen says
 * which of the two is missing (§13).
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useAcceptanceReading } from "@/components/acceptance/useAcceptanceReading";
import { useAcceptanceRound } from "@/components/acceptance/useAcceptanceRound";
import { Workspace } from "@/components/workspace/Workspace";
import { BUILD_SHA, mayStart, shortSha, versionGate } from "@/lib/acceptance/build-id";
import { BATCH_STEPS, batchVerdict } from "@/lib/acceptance/batch-steps";
import { formatBatchResult } from "@/lib/acceptance/batch-report";
import { deviceStorageSnapshot } from "@/lib/acceptance/device-storage";
import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { acceptanceSession, type AcceptanceSession } from "@/lib/acceptance/session";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { StorageLike } from "@/lib/song/storage";

/**
 * What only a browser knows, read the way the session is read.
 *
 * Rendering the viewport straight makes the server's HTML disagree with the
 * client's, which React resolves by throwing the page away — a hydration error
 * on a route whose job includes reporting a clean console.
 */
const SERVER_FACTS = { viewport: "", touchPoints: 0 } as const;
type Facts = { readonly viewport: string; readonly touchPoints: number };
let facts: Facts = SERVER_FACTS;

function readFacts(): Facts {
  if (typeof window === "undefined") return SERVER_FACTS;
  const viewport = `${window.innerWidth}×${window.innerHeight}`;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  /* A stable identity, or `useSyncExternalStore` loops forever. */
  if (facts.viewport !== viewport || facts.touchPoints !== touchPoints) {
    facts = { viewport, touchPoints };
  }
  return facts;
}

const EMPTY_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function Big({
  children,
  onClick,
  tone = "primary",
  testId,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "plain";
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-batch-action={testId}
      onClick={onClick}
      disabled={disabled}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`w-full rounded-lg border px-3 text-sm font-medium ${
        disabled
          ? "border-line text-muted opacity-50"
          : tone === "primary"
            ? "border-bronze bg-bronze/15 text-bronze"
            : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 p-4">{children}</div>;
}

/** Why a step will not pass yet, in a sentence rather than a code. */
const SHORTFALL_TEXT: Readonly<Record<string, string>> = {
  /*
   * "bu adıma ait" is the whole sentence's job (2V-B.2c §3 step 10). The old
   * wording — "henüz bir işlem gelmedi" — is true of a page where an event
   * arrived for another step, another track or another session, and a reader
   * who had just done something would read it as the harness being broken.
   */
  no_production_event: "Editörden henüz bu adıma ait kanıt gelmedi.",
  wrong_action: "Gelen işlem bu adımın istediği işlem değil.",
  no_write_expected: "Bu adımda hiçbir şey yazılmamalıydı; bir şey yazıldı.",
  write_not_atomic: "Tek bir kayıt bekleniyordu; sayı tutmadı.",
  undo_did_not_restore: "«Geri al» eski hâline dönmedi.",
  redo_did_not_return: "«İleri al» yazılan hâle dönmedi.",
  unanswered: "Sorunun cevabı verilmedi.",
};

export function EditorActionBatch() {
  const session = useSyncExternalStore<AcceptanceSession | null>(
    () => () => {},
    useCallback(() => acceptanceSession(editorFixture()), []),
    () => null,
  );

  const [startedAt] = useState(() => new Date().toISOString());
  const [fixture] = useState(() => editorFixture());
  const [expected] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("sha");
  });
  const gate = useMemo(() => versionGate(expected, BUILD_SHA), [expected]);

  const client = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    }, []),
    readFacts,
    () => SERVER_FACTS,
  );

  /*
   * The same read-only window the editor route installs (§8). A harness can
   * ask the record what it holds without this page rendering a song into an
   * attribute, and this page still writes nothing.
   */
  useAcceptanceReading(session?.storage ?? EMPTY_STORAGE);

  const round = useAcceptanceRound(session, fixture);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [storageBefore] = useState(() => deviceStorageSnapshot());
  /*
   * The whole device store, before and after — the coarse check that sits
   * beside the four measured domains. Read at the moment the result block is
   * drawn rather than stashed by an effect: reading storage is a read, and a
   * value cached in state is a value that can be cached at the wrong time.
   */
  const storageAfter = round.done ? deviceStorageSnapshot() : storageBefore;

  /*
   * What the two listening scopes actually asked the engine for (§14).
   *
   * Read off the same read-only debug handle the browser harness uses, while
   * the step is on screen. The founder cannot tell "one track" from "two
   * tracks that happen to sound alike"; this can.
   */
  const stepId = round.step?.id ?? "";
  useEffect(() => {
    if (stepId !== "trackScope" && stepId !== "measureScope") return;
    const timer = window.setInterval(() => {
      const plan = window.__aranjeDebug?.selection();
      if (plan) round.recordScopeFilter(stepId, plan.trackIds);
    }, 200);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  const environment = useMemo(
    () => ({
      touchPoints: client.touchPoints,
      consoleErrors: round.consoleErrors,
      userStorageBefore: storageBefore,
      userStorageAfter: storageAfter,
      measured: round.measured,
      trackScopeFilter: round.scopeFilters.trackScope ?? null,
      measureScopeFilter: round.scopeFilters.measureScope ?? null,
      /* A run the reader stopped can only be BLOCKED, never PASS (§3). */
      endedEarly: round.endedEarly,
    }),
    [
      client.touchPoints,
      round.endedEarly,
      round.consoleErrors,
      round.measured,
      round.scopeFilters,
      storageBefore,
      storageAfter,
    ],
  );

  const result = () =>
    formatBatchResult({
      buildSha: BUILD_SHA,
      device: {
        date: startedAt,
        viewport: client.viewport,
        platform: navigator.platform ?? "",
        touchPoints: client.touchPoints,
        userAgent: navigator.userAgent,
      },
      environment,
      answers: round.answers,
      note,
      isolation: round.isolation,
      ledgers: round.ledgers,
      /* The block builds its rows from these, and counts from those rows. */
      states: round.stepStates,
    });

  if (session !== null && !session.ok) {
    return (
      <Shell>
        <p data-batch-blocked className="text-reject text-sm">
          Test başlatılamadı: {session.reason}
        </p>
      </Shell>
    );
  }

  if (!mayStart(gate)) {
    return (
      <Shell>
        <p data-batch-wrong-version role="alert" className="text-reject text-sm">
          {gate.kind === "mismatch" || gate.kind === "unknown" ? gate.message : ""}
        </p>
        <p className="text-muted text-xs">
          Doğru sürümün bağlantısını aç ve sayfayı yenile. Bu test gerçek projeni
          değiştirmez.
        </p>
      </Shell>
    );
  }

  const onSong = round.screen === "song" && !round.done;
  const descriptor = round.envelope?.ok === true ? round.envelope.descriptor : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/*
        The session line. Normal flow, `shrink-0`, above the workspace rather
        than over it — so it cannot cover a production control and nothing
        under it can be pressed through it.
      */}
      <header
        data-batch-header
        className="border-line text-muted shrink-0 border-b px-3 py-1 text-[11px]"
      >
        <span className="text-text font-medium">Editör eylem kabulü</span>
        {" · "}
        <span data-batch-sha>{shortSha(BUILD_SHA)}</span>
        {" · "}
        <span data-batch-session>{round.sessionId}</span>
        {" · "}
        <span data-batch-viewport>{client.viewport}</span>
        {" · "}
        <span data-batch-touch>dokunma {client.touchPoints}</span>
        <br />
        <span data-batch-song>{round.support?.title ?? "—"}</span>
        {" · "}
        <span data-batch-fingerprint>{descriptor?.songFingerprint ?? "—"}</span>
        <br />
        <span data-batch-safety>Bu test gerçek projeni değiştirmez.</span>
      </header>

      {/*
        The workspace. Hidden — not unmounted — on the task screen, so it is
        out of layout, out of hit testing and out of pointer ownership while
        keeping the live task state §11 asks to come back to.
      */}
        {/*
          `[&>div]:h-full` — the workspace's own root is `h-dvh`, so without
          this it renders a full viewport of content inside a box that is
          shorter than one and `overflow-hidden` silently clips the bottom
          (2V-B.1 §15). Measured at 384×692: the stage was 556 px, the
          workspace laid out 761 px, and the whole transport bar and the
          composer door row were off screen and unhittable. The founder's run
          reported exactly that as "the controls were not there".

          The same arbitrary variant the conductor route already uses, for the
          same reason it uses it: a component that hard-codes the viewport
          height cannot be composed, and the honest fix at the call site is to
          hand it the room there actually is.
        */}
      <div
        data-acceptance-stage="song"
        hidden={!onSong}
        className="min-h-0 flex-1 overflow-hidden [&>div]:h-full"
      >
        {session?.ok ? <Workspace /> : null}
      </div>

      {onSong ? (
        <div
          data-acceptance-return
          className="border-line shrink-0 border-t px-3 py-2"
        >
          <Big testId="to-task" onClick={round.goToTask}>
            Teste dön
          </Big>
        </div>
      ) : (
        <section
          data-acceptance-stage="task"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        >
          {round.done ? (
            <>
              <h2 className="text-text text-sm font-medium">Sonuç</h2>
              <pre
                data-batch-result
                className="border-line text-muted max-h-[55dvh] overflow-auto rounded border p-2 text-[10px] whitespace-pre-wrap"
              >
                {result()}
              </pre>
              <Big
                testId="copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(result()).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? "Kopyalandı" : "Sonucu kopyala"}
              </Big>
              <Big testId="restart" tone="plain" onClick={round.restart}>
                Baştan başla
              </Big>
            </>
          ) : round.envelope?.ok === false ? (
            /*
             * The Song cannot carry this step. Not a question, and not a pass
             * (§12): a typed refusal the founder can send back.
             */
            <>
              <p data-batch-step className="text-muted text-[11px]">
                {round.step?.title} · {round.stepIndex + 1}/{BATCH_STEPS.length}
              </p>
              <p data-batch-unsupported className="text-reject text-sm">
                Bu şarkı bu adımı taşımıyor: {round.envelope.reason}
              </p>
              <Big testId="to-song" tone="plain" onClick={round.goToSong}>
                Şarkıya geç
              </Big>
            </>
          ) : descriptor && round.step ? (
            <>
              <p data-batch-step className="text-muted text-[11px]">
                {round.step.title} · {round.stepIndex + 1}/{BATCH_STEPS.length}
              </p>
              <p data-batch-task className="text-text text-sm">
                {descriptor.task}
              </p>
              {round.step.watchFor === "" ? null : (
                <p data-batch-for className="text-muted text-xs">
                  {round.step.watchFor}
                </p>
              )}

              {/*
                What is still missing, said plainly. A founder may stand here
                before the task is done; what they may not do is pass it.
              */}
              <p
                data-batch-evidence={round.judgement.passed ? "ready" : "missing"}
                /*
                 * Announced, not just drawn. The gate changes while the
                 * reader's attention is on the editor behind it, and a
                 * founder using a screen reader met the same silent disabled
                 * button the sighted founder did.
                 */
                role="status"
                aria-live="polite"
                className={`text-xs ${round.judgement.passed ? "text-muted" : "text-reject"}`}
              >
                {round.judgement.passed
                  ? "Editör kanıtı geldi."
                  : round.judgement.shortfalls
                      .map((name) => SHORTFALL_TEXT[name] ?? name)
                      .join(" ")}
              </p>
              {/*
                And which parts arrived, one line each (2V-B.2 §3).
                The founder reached step 10, did exactly what the instruction
                said, and met a disabled button with nothing to read. A
                checklist turns "it is stuck" into "it is waiting for this".
              */}
              <ul data-batch-checklist className="space-y-0.5">
                {round.evidenceItems.map((item) => (
                  <li
                    key={item.id}
                    data-batch-evidence-item={`${item.id}:${item.present ? "yes" : "no"}`}
                    className={`text-[11px] ${item.present ? "text-muted" : "text-reject"}`}
                  >
                    {item.present ? "✓" : "•"} {item.label}
                  </li>
                ))}
              </ul>
              {round.evidenceHint === null ? null : (
                <p data-batch-hint className="text-bronze text-xs">
                  {round.evidenceHint}
                </p>
              )}
              {round.evidence.refused.length > 0 ? (
                <p data-batch-refused className="text-muted text-[10px]">
                  Reddedilen olay: {round.evidence.refused.map((entry) => entry.refusal).join(", ")}
                </p>
              ) : null}

              {round.step.questions.map((question) => (
                <div key={question.id} className="space-y-1">
                  <p className="text-muted text-xs">{question.prompt}</p>
                  <div className="flex gap-2">
                    {question.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        data-batch-answer={`${question.id}:${option}`}
                        aria-pressed={round.answers[question.id] === option}
                        onClick={() => round.answer(question.id, option)}
                        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
                        className={`min-w-0 flex-1 rounded-lg border px-2 text-xs whitespace-nowrap ${
                          round.answers[question.id] === option
                            ? "border-bronze text-bronze"
                            : "border-line text-muted"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {round.step.id === "finish" ? (
                <textarea
                  data-batch-note
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Eklemek istediğin bir şey var mı?"
                  className="border-line text-text w-full rounded border bg-transparent p-2 text-xs"
                  rows={2}
                />
              ) : null}

              <Big testId="to-song" onClick={round.goToSong}>
                Şarkıya geç
              </Big>
              <div className="flex gap-2">
                {round.stepIndex > 0 ? (
                  <Big testId="back" tone="plain" onClick={round.back}>
                    Geri
                  </Big>
                ) : null}
                <Big
                  testId="next"
                  tone="plain"
                  disabled={!round.mayAdvance}
                  onClick={round.next}
                >
                  {round.stepIndex === BATCH_STEPS.length - 1
                    ? "Bitir"
                    : "Sonraki adım"}
                </Big>
              </div>
              {/*
                Two ways out of a step that will not complete (§3).

                "Tekrar dene" clears this step's evidence so the sequence can
                be attempted again without restarting all thirteen — the
                alternative a stuck reader had was to abandon the run.

                "Burada bitir" ends the round where it stands. It cannot
                produce a PASS: the steps never reached stay unmeasured and
                `endedEarly` forces BLOCKED, so what it produces is a report
                that says the founder was stopped, which is the most useful
                thing a blocked run can hand back.
              */}
              {round.judgement.passed ? null : (
                <div className="flex gap-2">
                  <Big testId="retry-step" tone="plain" onClick={round.retryStep}>
                    Tekrar dene
                  </Big>
                  <Big testId="end-early" tone="plain" onClick={round.endEarly}>
                    Burada bitir ve sonucu oluştur
                  </Big>
                </div>
              )}
              <p data-batch-verdict className="text-muted text-[10px]">
                Şu anki durum: {batchVerdict(environment, round.answers)}
              </p>
              {/*
                Counted off the rows, and counting only the rows whose
                evidence arrived. `measured` now carries a key for every step
                — `null` where nothing was measured — so counting its keys
                would say 13/13 on a run that had done nothing, which is the
                same sentence in a different place as the defect this round
                removes.
              */}
              <p
                data-batch-measured={JSON.stringify(round.stepStates)}
                className="text-muted text-[10px]"
              >
                Kanıtı gelen adım:{" "}
                {round.rows.filter((row) => row.evidence === "valid").length}/
                {BATCH_STEPS.length}
              </p>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
