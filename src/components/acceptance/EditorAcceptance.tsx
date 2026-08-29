"use client";

/**
 * The guided founder editor test (2U-A handoff §3–§6).
 *
 * One task on screen at a time, in Turkish, over the **real** workspace on a
 * fixed two-track fixture, in a storage this page owns. It can be run on a
 * phone that already has the reader's own music on it without touching a byte
 * of it, and it says so on screen.
 *
 * Nothing here performs an editor operation. The reader does each one through
 * the production control; this takes a snapshot at every phase boundary and
 * compares. A route that pressed the buttons for them would be a route that
 * tested itself.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Workspace } from "@/components/workspace/Workspace";
import { useEditorWatch } from "@/components/acceptance/useEditorWatch";
import { BUILD_SHA, mayStart, shortSha, versionGate } from "@/lib/acceptance/build-id";
import {
  automatedVerdict,
  formatEditorResult,
  type EditorAnswers,
} from "@/lib/acceptance/editor-report";
import { EDITOR_BASS_ID, editorFixture } from "@/lib/acceptance/editor-fixture";
import { invariantChecks } from "@/lib/acceptance/editor-invariants";
import {
  EDITOR_STEPS,
  emptyChecks,
  judgePhase,
  type Check,
} from "@/lib/acceptance/editor-steps";
import { createMemoryStorage } from "@/lib/acceptance/memory-storage";
import { acceptanceSession, type AcceptanceSession } from "@/lib/acceptance/session";
import type { Song } from "@/lib/song/schema";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/* Somewhere for the watcher to look before the session exists. */
const EMPTY_STORAGE = createMemoryStorage();

/**
 * What only a browser knows, read the way the session is read.
 *
 * The header shows the viewport and whether the device has touch, and both
 * are facts the server cannot have. Rendering them straight made the server's
 * HTML disagree with the client's and React threw the page away and rebuilt
 * it — a hydration error in the console of a route whose whole job is to
 * report a clean console.
 *
 * `useSyncExternalStore` is where React puts that seam: the server and the
 * hydration pass both see the placeholder, the client sees the truth, and no
 * pass disagrees with another.
 */
const CLIENT_FACTS_SERVER = { viewport: "", touchPoints: 0 } as const;

type ClientFacts = { readonly viewport: string; readonly touchPoints: number };

let clientFacts: ClientFacts = CLIENT_FACTS_SERVER;

function readClientFacts(): ClientFacts {
  if (typeof window === "undefined") return CLIENT_FACTS_SERVER;
  const viewport = `${window.innerWidth}×${window.innerHeight}`;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  /* A stable identity, or `useSyncExternalStore` would loop forever. */
  if (clientFacts.viewport !== viewport || clientFacts.touchPoints !== touchPoints) {
    clientFacts = { viewport, touchPoints };
  }
  return clientFacts;
}

/** Every phase of every step, flattened, because that is what a screen is. */
const SCREENS = EDITOR_STEPS.flatMap((step) =>
  step.phases.map((phase, index) => ({ step, phase, first: index === 0 })),
);

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
      data-acceptance-action={testId}
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

export function EditorAcceptance() {
  /*
   * The storage swap, read the way the song itself is read. The server has no
   * storage to swap, so both the server and the hydration pass see `null` and
   * the client sees the installed session — no pass disagrees with another.
   */
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

  const facts = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    }, []),
    readClientFacts,
    () => CLIENT_FACTS_SERVER,
  );

  const watch = useEditorWatch(session?.storage ?? EMPTY_STORAGE);

  const [screen, setScreen] = useState(0);
  const [checks, setChecks] = useState<Record<string, Check>>(() => emptyChecks());
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<EditorAnswers>({});
  const [notes, setNotes] = useState("");
  /*
   * The picture taken as a screen is entered. A ref rather than state: the
   * value is read once, by the handler that ends the phase, and putting it in
   * state would render the whole workspace again to store a number nothing
   * draws.
   */
  const before = useRef<ReturnType<typeof watch.snapshot> | null>(null);
  const [copied, setCopied] = useState(false);

  const current = SCREENS[screen];
  const done = screen >= SCREENS.length;

  /*
   * The "before" picture is taken as a screen is entered, never when it is
   * left. Taking it on the way out would compare a gesture with itself.
   */
  useEffect(() => {
    if (!session?.ok || done) return;
    before.current = watch.snapshot();
    /* `watch.snapshot` is stable; the screen index is what moves. */
  }, [screen, session?.ok, done, watch]);

  /* The device's own store as the run ends, taken through the watcher. */
  const [userStorageAfter, setUserStorageAfter] = useState<string | null>(null);

  const finishPhase = () => {
    if (!current) return;
    const after = watch.snapshot();
    const start = before.current ?? after;
    const passed = judgePhase(current.phase.expect, {
      songBefore: start.song,
      songAfter: after.song,
      revisionBefore: start.revision,
      revisionAfter: after.revision,
      bandBefore: start.band,
      bandAfter: after.band,
      marks,
    });
    /*
     * The musical promise, asked of the two songs rather than of the history.
     * A gesture can write exactly once and still change what is heard.
     */
    const musical = songsOf(start.song, after.song)
      ? invariantChecks(
          current.phase.id,
          songsOf(start.song, after.song)!.before,
          songsOf(start.song, after.song)!.after,
          EDITOR_BASS_ID,
        )
      : {};

    setChecks((all) => ({ ...all, ...musical, [current.phase.id]: passed }));
    const expectation = current.phase.expect;
    if (expectation.kind === "mark") {
      setMarks((all) => ({ ...all, [expectation.mark]: after.song }));
    }
    /*
     * The paste step's "before" is what undo has to come back to, and it is
     * only knowable before the paste happens — so it is remembered here
     * rather than by a phase of its own.
     */
    if (current.phase.id === "pasteTargetPicked") {
      setMarks((all) => ({ ...all, beforePaste: after.song }));
    }
    /*
     * The device's own store is re-read here rather than in an effect: this
     * is the moment the run ends. The reading itself is the watcher's — no
     * component names a storage key or reaches for a store (spec 13.21 §8) —
     * and what it must say is that not a byte moved.
     */
    if (screen === SCREENS.length - 1) setUserStorageAfter(watch.userStorageNow());
    setScreen((index) => index + 1);
  };

  const observations = useMemo(
    () => ({
      checks: {
        ...checks,
        ...Object.fromEntries(
          Object.entries(watch.standing).filter(([, value]) => value !== null),
        ),
        /* A fact about the fixture, known without pressing anything. */
        fixtureHasTwoTracks: editorFixture().tracks.length >= 2,
        noConsoleError: watch.consoleErrors.length === 0,
        userStorageUnchanged:
          userStorageAfter === null ? null : userStorageAfter === watch.userStorageBefore,
      } as Record<string, Check>,
      consoleErrors: watch.consoleErrors,
      userStorageBefore: watch.userStorageBefore,
      userStorageAfter: userStorageAfter ?? watch.userStorageBefore,
    }),
    [checks, watch.standing, watch.consoleErrors, watch.userStorageBefore, userStorageAfter],
  );

  const result = () =>
    formatEditorResult({
      gate,
      device: {
        date: startedAt,
        viewport: facts.viewport,
        platform: navigator.platform ?? "",
        touchPoints: facts.touchPoints,
        userAgent: navigator.userAgent,
      },
      observations,
      answers,
      notes,
    });

  if (session !== null && !session.ok) {
    return (
      <Shell>
        <p data-acceptance-blocked className="text-reject text-sm">
          Test başlatılamadı: {session.reason}
        </p>
      </Shell>
    );
  }

  if (!mayStart(gate)) {
    return (
      <Shell>
        <p data-acceptance-wrong-version role="alert" className="text-reject text-sm">
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
        data-acceptance-header
        className="border-line text-muted shrink-0 border-b px-3 py-1 text-[11px]"
      >
        <span className="text-text font-medium">Editör kabulü</span>
        {" · "}
        <span data-acceptance-sha>{shortSha(BUILD_SHA)}</span>
        {" · "}
        <span data-acceptance-viewport>{facts.viewport}</span>
        {" · "}
        <span data-acceptance-touch>dokunma {facts.touchPoints}</span>
        <br />
        <span data-acceptance-safety>Bu test gerçek projeni değiştirmez.</span>
      </header>

      {/*
        The real workspace, on the fixture, in this page's own storage.

        `overflow-hidden` is not decoration. Without it the workspace's own
        bottom chrome painted *over* the guide at 412px — the guide's own
        "Geri" was on screen, enabled and the right size, and every press on
        it went to a toolbar button underneath. The four-viewport run caught
        it because the same press worked at 320 and on the desktop; a
        one-viewport check would have shipped it.
      */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {session?.ok ? <Workspace /> : null}
      </div>

      {/*
        The guide scrolls; the workspace does not give up its room.

        On a 320px phone the result screen carries three questions, a note
        field, the block itself and three buttons — more than fits under a
        staff that needs 286px. Left unscrollable those controls sit below the
        fold and simply cannot be pressed, which the four-viewport run found
        by failing to click them on every phone and passing on the desktop.

        A cap plus its own scroller is the smaller hammer: the staff keeps the
        height it needs, and everything the reader has to reach is reachable.
      */}
      <section
        data-acceptance-guide
        className="border-line bg-panel max-h-[58dvh] shrink-0 space-y-2 overflow-y-auto border-t px-3 py-2"
      >
        {done ? (
          <>
            <h2 className="text-text text-sm font-medium">Sonuç</h2>
            {ALL_QUESTION_LIST.map((question) => (
              <div key={question.id} className="space-y-1">
                <p className="text-muted text-xs">{question.prompt}</p>
                <div className="flex gap-1.5">
                  {question.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      data-acceptance-answer={`${question.id}:${option}`}
                      aria-pressed={answers[question.id] === option}
                      onClick={() =>
                        setAnswers((all) => ({ ...all, [question.id]: option }))
                      }
                      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
                      className={`flex-1 rounded-lg border px-2 text-xs ${
                        answers[question.id] === option
                          ? "border-bronze bg-bronze/15 text-bronze"
                          : "border-line text-muted"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <textarea
              data-acceptance-notes
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Bulduğun sorun veya zorlandığın yer nedir?"
              className="border-line bg-app text-text w-full rounded-lg border px-2 py-1 text-xs"
              rows={3}
            />
            <p data-acceptance-verdict className="text-muted text-xs">
              Automated verdict: {automatedVerdict(observations, answers)}
            </p>
            <Big
              testId="copy"
              onClick={() => {
                const text = result();
                navigator.clipboard?.writeText(text).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? "Kopyalandı" : "Sonucu kopyala"}
            </Big>
            {/* Always rendered, so a browser that refuses the clipboard still
                gives the reader something they can select by hand. */}
            <textarea
              data-acceptance-result
              readOnly
              value={result()}
              rows={6}
              className="border-line bg-app text-muted w-full rounded-lg border px-2 py-1 font-mono text-[10px]"
            />
            <Big
              tone="plain"
              testId="restart"
              onClick={() => {
                /* A reload rebuilds the disposable session from scratch. */
                window.location.reload();
              }}
            >
              Baştan dene
            </Big>
          </>
        ) : current ? (
          <>
            <p data-acceptance-step className="text-muted text-[11px]">
              {current.step.title} · {screen + 1}/{SCREENS.length}
            </p>
            <p data-acceptance-task className="text-text text-sm">
              {current.phase.text}
            </p>
            <div className="flex gap-2">
              <Big
                tone="plain"
                testId="back"
                onClick={() => setScreen((index) => Math.max(0, index - 1))}
              >
                Geri
              </Big>
              <Big testId="did" onClick={finishPhase}>
                Yaptım
              </Big>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

const ALL_QUESTION_LIST = EDITOR_STEPS.flatMap((step) => step.questions);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-dvh flex-col justify-center gap-3 px-6">
      <h1 className="text-text text-base font-medium">Editör kabulü</h1>
      {children}
    </main>
  );
}

/**
 * The two songs behind two readings, or null when either cannot be parsed.
 *
 * The storage holds JSON; the invariants want a `Song`. Parsing here rather
 * than inside the invariants keeps that module pure and free of the storage's
 * shape, and an unparseable reading answers no musical question rather than a
 * wrong one.
 */
function songsOf(
  beforeJson: string,
  afterJson: string,
): { before: Song; after: Song } | null {
  try {
    const before = JSON.parse(beforeJson) as Song;
    const after = JSON.parse(afterJson) as Song;
    if (!before?.sections || !after?.sections) return null;
    return { before, after };
  } catch {
    return null;
  }
}
