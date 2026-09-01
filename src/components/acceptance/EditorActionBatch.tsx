"use client";

/**
 * The single batched founder round (2V-B §9).
 *
 * Twelve screens over the **real** workspace, on a fixture in a storage this
 * page owns. It presses nothing on the reader's behalf and it has no control
 * of its own that does what a production control does: the only way to hear
 * anything, or to change anything, is the app.
 *
 * ## The division of labour
 *
 * The founder answers what only a person can. The page measures what only a
 * machine can: while a step is on screen it samples the project record — its
 * bytes and its revision — and keeps the sequence of distinct states. That
 * trace is what "one atomic write" and "undo came back byte-identical" are
 * judged against, in `batch-steps.ts`, and a founder who presses "Sonraki"
 * without doing the step leaves a trace of one state, which fails.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useAcceptanceReading } from "@/components/acceptance/useAcceptanceReading";
import { Workspace } from "@/components/workspace/Workspace";
import { BUILD_SHA, mayStart, shortSha, versionGate } from "@/lib/acceptance/build-id";
import {
  BATCH_STEPS,
  batchVerdict,
  judgeBatchStep,
  type BatchAnswers,
  type BatchTrace,
} from "@/lib/acceptance/batch-steps";
import { formatBatchResult } from "@/lib/acceptance/batch-report";
import { deviceStorageSnapshot } from "@/lib/acceptance/device-storage";
import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { readFixture } from "@/lib/acceptance/fixture-read";
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "plain";
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-batch-action={testId}
      onClick={onClick}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`w-full rounded-lg border px-3 text-sm font-medium ${
        tone === "primary"
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

export function EditorActionBatch() {
  const session = useSyncExternalStore<AcceptanceSession | null>(
    () => () => {},
    useCallback(() => acceptanceSession(editorFixture()), []),
    () => null,
  );

  const [startedAt] = useState(() => new Date().toISOString());
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

  const [screen, setScreen] = useState(0);
  const [answers, setAnswers] = useState<BatchAnswers>({});
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [measured, setMeasured] = useState<Record<string, boolean | null>>({});

  /*
   * Errors are collected rather than sampled. A render that threw and
   * recovered still threw, and a report that only looked at the end would
   * miss it.
   */
  const [consoleErrors, setConsoleErrors] = useState<readonly string[]>([]);
  useEffect(() => {
    const onError = (event: ErrorEvent) =>
      setConsoleErrors((all) => [...all, event.message].slice(0, 20));
    const onRejection = (event: PromiseRejectionEvent) =>
      setConsoleErrors((all) => [...all, String(event.reason)].slice(0, 20));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const [storageBefore] = useState(() => deviceStorageSnapshot());
  const [storageAfter, setStorageAfter] = useState<string | null>(null);

  const current = BATCH_STEPS[screen];
  const done = screen >= BATCH_STEPS.length;

  /*
   * The record's own trace while this step is on screen.
   *
   * A ref, sampled by an interval: nothing draws it, and putting it in state
   * would re-render the real workspace several times a second forever — a
   * mistake the previous route made once and found only because no button
   * ever stood still long enough to be pressed.
   */
  const trace = useRef<{ states: string[]; revisions: number[] }>({
    states: [],
    revisions: [],
  });

  const sample = useCallback(() => {
    const reading = readFixture(session?.storage ?? EMPTY_STORAGE);
    const states = trace.current.states;
    if (states[states.length - 1] !== reading.song) {
      states.push(reading.song);
      trace.current.revisions.push(reading.revision);
    }
  }, [session?.storage]);

  /* A fresh trace as each step is entered, and a first reading straight away. */
  useEffect(() => {
    if (!session?.ok || done) return;
    trace.current = { states: [], revisions: [] };
    sample();
    const timer = window.setInterval(sample, 300);
    return () => window.clearInterval(timer);
  }, [screen, session?.ok, done, sample]);

  const environment = useMemo(
    () => ({
      touchPoints: client.touchPoints,
      consoleErrors,
      userStorageBefore: storageBefore,
      userStorageAfter: storageAfter ?? storageBefore,
      measured,
    }),
    [client.touchPoints, consoleErrors, storageBefore, storageAfter, measured],
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
      answers,
      note,
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

  const finishStep = () => {
    if (!current) return;
    sample();
    const seen: BatchTrace = {
      states: [...trace.current.states],
      revisions: [...trace.current.revisions],
    };
    setMeasured((all) => ({
      ...all,
      [current.id]: judgeBatchStep(current.expect, seen),
    }));
    if (screen === BATCH_STEPS.length - 1) setStorageAfter(deviceStorageSnapshot());
    setScreen(screen + 1);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header
        data-batch-header
        className="border-line text-muted shrink-0 border-b px-3 py-1 text-[11px]"
      >
        <span className="text-text font-medium">Editör eylem kabulü</span>
        {" · "}
        <span data-batch-sha>{shortSha(BUILD_SHA)}</span>
        {" · "}
        <span data-batch-viewport>{client.viewport}</span>
        {" · "}
        <span data-batch-touch>dokunma {client.touchPoints}</span>
        <br />
        <span data-batch-safety>Bu test gerçek projeni değiştirmez.</span>
      </header>

      {/*
        The real workspace, on the fixture, in this page's own storage.

        `overflow-hidden` for the reason the editor route learned it: without
        it the workspace's own bottom chrome paints over the guide, and every
        press on the guide's controls lands on a toolbar button underneath.
      */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {session?.ok ? <Workspace /> : null}
      </div>

      <section
        data-batch-guide
        className="border-line bg-panel max-h-[58dvh] shrink-0 space-y-2 overflow-y-auto border-t px-3 py-2"
      >
        {done ? (
          <>
            <h2 className="text-text text-sm font-medium">Sonuç</h2>
            <pre
              data-batch-result
              className="border-line text-muted max-h-48 overflow-auto rounded border p-2 text-[10px] whitespace-pre-wrap"
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
            <Big testId="restart" tone="plain" onClick={() => setScreen(0)}>
              Baştan başla
            </Big>
          </>
        ) : current ? (
          <>
            <p data-batch-step className="text-muted text-[11px]">
              {current.title} · {screen + 1}/{BATCH_STEPS.length}
            </p>
            <p data-batch-task className="text-text text-sm">
              {current.task}
            </p>
            {current.watchFor === "" ? null : (
              <p data-batch-for className="text-muted text-xs">
                {current.watchFor}
              </p>
            )}

            {current.questions.map((question) => (
              <div key={question.id} className="space-y-1">
                <p className="text-muted text-xs">{question.prompt}</p>
                <div className="flex gap-2">
                  {question.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      data-batch-answer={`${question.id}:${option}`}
                      aria-pressed={answers[question.id] === option}
                      onClick={() =>
                        setAnswers((all) => ({ ...all, [question.id]: option }))
                      }
                      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
                      className={`min-w-0 flex-1 rounded-lg border px-2 text-xs whitespace-nowrap ${
                        answers[question.id] === option
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

            {current.id === "finish" ? (
              <textarea
                data-batch-note
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Eklemek istediğin bir şey var mı?"
                className="border-line text-text w-full rounded border bg-transparent p-2 text-xs"
                rows={2}
              />
            ) : null}

            <div className="flex gap-2">
              {screen > 0 ? (
                <Big testId="back" tone="plain" onClick={() => setScreen(screen - 1)}>
                  Geri
                </Big>
              ) : null}
              <Big testId="next" onClick={finishStep}>
                {screen === BATCH_STEPS.length - 1 ? "Bitir" : "Sonraki"}
              </Big>
            </div>
            <p data-batch-verdict className="text-muted text-[10px]">
              Şu anki durum: {batchVerdict(environment, answers)}
            </p>
            <p
              data-batch-measured={JSON.stringify(measured)}
              className="text-muted text-[10px]"
            >
              Ölçülen adım: {Object.keys(measured).length}/{BATCH_STEPS.length}
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}
