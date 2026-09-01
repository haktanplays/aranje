"use client";

/**
 * The guided founder listening test (2V-A.1 §7–§9).
 *
 * Eight screens, one task each, in Turkish, over the **real** workspace on a
 * two-track fixture in a storage this page owns. Every sound it produces was
 * started by the reader pressing a production control; this page presses
 * nothing and schedules nothing. A route that played the music for them would
 * be a route that accepted itself.
 *
 * What it measures on its own is small and honest: whether the reader's own
 * store moved, and whether the app wrote to the console. Everything else is a
 * question only ears can answer, and the block at the end says which is which.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { Workspace } from "@/components/workspace/Workspace";
import { BUILD_SHA, mayStart, shortSha, versionGate } from "@/lib/acceptance/build-id";
import { deviceStorageSnapshot } from "@/lib/acceptance/device-storage";
import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { formatListeningResult } from "@/lib/acceptance/listening-report";
import {
  LISTENING_STEPS,
  listeningVerdict,
  type ListeningAnswers,
} from "@/lib/acceptance/listening-steps";
import { acceptanceSession, type AcceptanceSession } from "@/lib/acceptance/session";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/**
 * What only a browser knows, read the way the session is read.
 *
 * The header shows the viewport and whether the device has touch, and the
 * server cannot have either. Rendering them straight makes the server's HTML
 * disagree with the client's, which React resolves by throwing the page away
 * — a hydration error on a route whose job includes reporting a clean console.
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
      data-listening-action={testId}
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

export function SelectionPlaybackAcceptance() {
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

  const [screen, setScreen] = useState(0);
  const [answers, setAnswers] = useState<ListeningAnswers>({});
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

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

  /* The device's own store as the run starts, and again as it ends. */
  const [storageBefore] = useState(() => deviceStorageSnapshot());
  const [storageAfter, setStorageAfter] = useState<string | null>(null);

  const current = LISTENING_STEPS[screen];
  const done = screen >= LISTENING_STEPS.length;

  const environment = useMemo(
    () => ({
      touchPoints: client.touchPoints,
      consoleErrors,
      userStorageBefore: storageBefore,
      userStorageAfter: storageAfter ?? storageBefore,
    }),
    [client.touchPoints, consoleErrors, storageBefore, storageAfter],
  );

  const result = () =>
    formatListeningResult({
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
        <p data-listening-blocked className="text-reject text-sm">
          Test başlatılamadı: {session.reason}
        </p>
      </Shell>
    );
  }

  if (!mayStart(gate)) {
    return (
      <Shell>
        <p data-listening-wrong-version role="alert" className="text-reject text-sm">
          {gate.kind === "mismatch" || gate.kind === "unknown" ? gate.message : ""}
        </p>
        <p className="text-muted text-xs">
          Doğru sürümün bağlantısını aç ve sayfayı yenile. Bu test gerçek projeni
          değiştirmez.
        </p>
      </Shell>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header
        data-listening-header
        className="border-line text-muted shrink-0 border-b px-3 py-1 text-[11px]"
      >
        <span className="text-text font-medium">Seçimi dinle kabulü</span>
        {" · "}
        <span data-listening-sha>{shortSha(BUILD_SHA)}</span>
        {" · "}
        <span data-listening-viewport>{client.viewport}</span>
        {" · "}
        <span data-listening-touch>dokunma {client.touchPoints}</span>
        <br />
        <span data-listening-safety>Bu test gerçek projeni değiştirmez.</span>
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

      {/*
        The guide scrolls; the workspace does not give up its room. At 320px a
        step with three questions is taller than what is left under a staff
        that needs 286px, and controls below the fold cannot be pressed.
      */}
      <section
        data-listening-guide
        className="border-line bg-panel max-h-[58dvh] shrink-0 space-y-2 overflow-y-auto border-t px-3 py-2"
      >
        {done ? (
          <>
            <h2 className="text-text text-sm font-medium">Sonuç</h2>
            <pre
              data-listening-result
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
            <p data-listening-step className="text-muted text-[11px]">
              {current.title} · {screen + 1}/{LISTENING_STEPS.length}
            </p>
            <p data-listening-task className="text-text text-sm">
              {current.task}
            </p>
            {current.listenFor === "" ? null : (
              <p data-listening-for className="text-muted text-xs">
                {current.listenFor}
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
                      data-listening-answer={`${question.id}:${option}`}
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
                data-listening-note
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
              <Big
                testId="next"
                onClick={() => {
                  /* The device's store is read as the last screen is left, so
                     the block reports what the whole run cost it. */
                  if (screen === LISTENING_STEPS.length - 1) {
                    setStorageAfter(deviceStorageSnapshot());
                  }
                  setScreen(screen + 1);
                }}
              >
                {screen === LISTENING_STEPS.length - 1 ? "Bitir" : "Sonraki"}
              </Big>
            </div>
            <p data-listening-verdict className="text-muted text-[10px]">
              Şu anki durum: {listeningVerdict(environment, answers)}
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}
