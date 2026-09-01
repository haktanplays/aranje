"use client";

/**
 * The whole 2V-B.1 round, as state (§4, §5, §12, §13, §14).
 *
 * The route component draws; this decides. That split is not tidiness — it is
 * why the four isolation domains, the transaction ledger and the task
 * descriptors can be reasoned about at all: none of them is a rendering
 * concern, and a component that owned them would be the place they quietly
 * disagreed with each other.
 *
 * What it holds, and where each number comes from:
 *
 * - **The device's own storage.** A watcher, installed once for the whole
 *   page, counting real writes to production keys and holding the bytes it
 *   started with (§4, domain 1).
 * - **The disposable clone.** Read off the project record the app writes,
 *   with its own journal for the write count (§4, domain 2).
 * - **The record and the history**, read from the same two authorities (§4,
 *   domain 3).
 * - **The production event stream.** What the editor said it did, after it
 *   did it — the only thing allowed to complete a writing step (§13).
 *
 * Every per-step measurement is **keyed by step id** rather than reset when
 * the round moves on. A trace that has to be cleared on entry is a trace
 * whose clearing can be missed, and it is also a render-time read of mutable
 * state; keyed, entering a step simply finds nothing there yet.
 *
 * Nothing here presses anything on the founder's behalf, and nothing here is
 * a second way to change the Song.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { BUILD_SHA } from "@/lib/acceptance/build-id";
import {
  BATCH_STEPS,
  judgeBatchStep,
  stepAnswered,
  type BatchAnswers,
  type BatchJudgement,
  type BatchStep,
  type BatchTrace,
} from "@/lib/acceptance/batch-steps";
import {
  sharedDeviceProjectWatch,
  storageHash,
} from "@/lib/acceptance/device-storage";
import {
  fixtureSongWrites,
  mentionsFixtureKey,
  readFixture,
} from "@/lib/acceptance/fixture-read";
import {
  judgeIsolation,
  type IsolationTruth,
} from "@/lib/acceptance/isolation-truth";
import { songSupport, type SongSupport } from "@/lib/acceptance/song-support";
import type { AcceptanceSession } from "@/lib/acceptance/session";
import {
  describeTask,
  judgeWorkspaceEvent,
  type EventRefusal,
  type TaskEnvelope,
} from "@/lib/acceptance/task-descriptor";
import {
  judgeActionLedger,
  type ActionLedger,
  type LedgerAction,
  type TransactionPoint,
} from "@/lib/acceptance/transaction-ledger";
import {
  canonicalBytes,
  subscribeWorkspaceEdits,
  type WorkspaceEdit,
} from "@/lib/song/workspace-events";
import type { Song } from "@/lib/song/schema";

/** Which of the two full-screen states is showing (§11). */
export type AcceptanceScreen = "song" | "task";

export type StepEvidence = {
  /** Production events accepted for this step, in order. */
  readonly accepted: readonly WorkspaceEdit[];
  /** Events that arrived and were refused, with the reason (§13). */
  readonly refused: readonly {
    readonly edit: WorkspaceEdit;
    readonly refusal: EventRefusal;
  }[];
};

const EMPTY_EVIDENCE: StepEvidence = { accepted: [], refused: [] };
const EMPTY_TRACE: BatchTrace = {
  states: [],
  revisions: [],
  histories: [],
  writes: [],
  events: [],
};

const EMPTY_STORAGE = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/** Which ledger row a step fills, or nothing when it writes nothing. */
const LEDGER_OF: Readonly<Partial<Record<string, LedgerAction>>> = {
  copyPaste: "paste",
  duplicate: "duplicate",
  move: "move",
  repeat: "repeat",
  deleteUndo: "delete",
};

export type AcceptanceRound = {
  readonly sessionId: string;
  readonly screen: AcceptanceScreen;
  readonly stepIndex: number;
  readonly step: BatchStep | null;
  readonly done: boolean;
  /** The task, bound to the Song on screen, or why it cannot be asked. */
  readonly envelope: TaskEnvelope | null;
  readonly support: SongSupport;
  readonly answers: BatchAnswers;
  readonly evidence: StepEvidence;
  /** What is still missing before this step may pass. */
  readonly judgement: BatchJudgement;
  readonly answered: boolean;
  /** True only when the evidence and the answers are both in. */
  readonly mayAdvance: boolean;
  readonly measured: Readonly<Record<string, boolean | null>>;
  readonly ledgers: readonly ActionLedger[];
  readonly isolation: IsolationTruth | null;
  readonly consoleErrors: readonly string[];
  readonly scopeFilters: Readonly<Record<string, readonly string[] | null>>;
  goToSong(): void;
  goToTask(): void;
  answer(questionId: string, option: string): void;
  next(): void;
  back(): void;
  restart(): void;
  /** What the two listening scopes asked the engine for (§14). */
  recordScopeFilter(stepId: string, trackIds: readonly string[]): void;
};

export function useAcceptanceRound(
  session: AcceptanceSession | null,
  fixture: Song,
): AcceptanceRound {
  /*
   * The device watcher, installed on the first render and before the
   * workspace has done anything (§4). A module singleton, so a second render
   * — a StrictMode double-invoke, a hydration retry — finds the one that is
   * already counting rather than patching the prototype again.
   */
  const watch = sharedDeviceProjectWatch();
  /*
   * The session's own name (§4).
   *
   * Read through `useSyncExternalStore` with an empty server snapshot rather
   * than made in a `useState` initializer, because an id made on the server
   * and an id made on the client are two different strings — and React's
   * answer to a mismatched attribute is to throw the page away, which is a
   * hydration error on a route whose job includes reporting a clean console.
   * The measured symptom was React error #418 on all five viewports.
   */
  const sessionId = useSyncExternalStore(subscribeNothing, clientSessionId, () => "");
  const [screen, setScreen] = useState<AcceptanceScreen>("song");
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<BatchAnswers>({});
  const [measured, setMeasured] = useState<Record<string, boolean | null>>({});
  const [ledgers, setLedgers] = useState<readonly ActionLedger[]>([]);
  const [isolation, setIsolation] = useState<IsolationTruth | null>(null);
  const [consoleErrors, setConsoleErrors] = useState<readonly string[]>([]);
  const [traces, setTraces] = useState<Record<string, BatchTrace>>({});
  const [evidenceByStep, setEvidenceByStep] = useState<
    Record<string, StepEvidence>
  >({});
  const [scopeFilters, setScopeFilters] = useState<
    Record<string, readonly string[] | null>
  >({});
  /**
   * The Song fingerprint the current task is bound to (§12).
   *
   * A chain rather than a constant: an accepted action produces the next
   * link, and the step after it binds to that. A task still bound to the
   * fixture's opening bytes after two edits would accept an event about a
   * Song that no longer exists.
   */
  const [chainFingerprint, setChainFingerprint] = useState<string | null>(null);

  const step = BATCH_STEPS[stepIndex] ?? null;
  const stepId = step?.id ?? "";
  const done = stepIndex >= BATCH_STEPS.length;
  const storage = session?.storage ?? EMPTY_STORAGE;

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

  /*
   * The Song as it is now, read from the record the app writes rather than
   * from the fixture this page opened with. After an edit those are two
   * different songs, and a task generated from the second one would describe
   * music the founder has already changed.
   */
  const reading = readFixture(storage);
  const currentSong = useMemo<Song>(() => {
    if (reading.song === "") return fixture;
    try {
      return JSON.parse(reading.song) as Song;
    } catch {
      return fixture;
    }
  }, [reading.song, fixture]);

  const support = useMemo(() => songSupport(currentSong), [currentSong]);
  const fingerprint = chainFingerprint ?? support.fingerprint;

  const envelope = useMemo<TaskEnvelope | null>(() => {
    if (!step) return null;
    return describeTask({
      step,
      support,
      buildSha: BUILD_SHA,
      sessionId,
      songFingerprint: fingerprint,
      revision: reading.revision,
    });
  }, [step, support, sessionId, fingerprint, reading.revision]);

  /*
   * The record's own trace while this step is on screen.
   *
   * Sampled by an interval and kept per step. A new state is appended only
   * when the bytes actually change, so an idle step costs one render at
   * entry and none afterwards.
   */
  useEffect(() => {
    if (!session?.ok || stepId === "") return;
    const sample = () => {
      const now = readFixture(session.storage);
      /*
       * Canonical bytes in the trace (§5). The record is rewritten in the
       * store's key order the first time a session commits, so raw bytes
       * report a difference across that moment that is not a difference in
       * the music — and an undo that came back exactly would be recorded as
       * `undo_hash_mismatch`.
       */
      const song = canonicalBytes(now.song);
      /*
       * The history's depth and the store's write count are read at the same
       * instant as the bytes (§5). A ledger that filled them in afterwards
       * would be describing a moment that had already passed.
       */
      const snapshot = session.store?.getSnapshot();
      const history = snapshot ? snapshot.undoDepth + snapshot.redoDepth + 1 : 1;
      const written = fixtureSongWrites(session.storage, session.initialJournalLength);
      setTraces((all) => {
        const current = all[stepId] ?? EMPTY_TRACE;
        const last = current.states[current.states.length - 1];
        if (last === song) return all;
        return {
          ...all,
          [stepId]: {
            ...current,
            states: [...current.states, song],
            revisions: [...current.revisions, now.revision],
            histories: [...(current.histories ?? []), history],
            writes: [...(current.writes ?? []), written],
          },
        };
      });
    };
    sample();
    const timer = window.setInterval(sample, 200);
    return () => window.clearInterval(timer);
  }, [session, stepId]);

  /*
   * The production event stream (§13).
   *
   * Every event is judged against the descriptor on screen before it counts.
   * A refusal is kept rather than dropped: "an event arrived and was rejected
   * because it named another track" is exactly the sentence a founder needs
   * when a step will not advance.
   */
  useEffect(() => {
    if (!envelope?.ok || stepId === "") return;
    const descriptor = envelope.descriptor;
    return subscribeWorkspaceEdits((edit) => {
      const verdict = judgeWorkspaceEvent({
        descriptor,
        edit,
        stamp: {
          buildSha: BUILD_SHA,
          sessionId,
          revision: readFixture(session?.storage ?? EMPTY_STORAGE).revision,
        },
      });
      setEvidenceByStep((all) => {
        const current = all[stepId] ?? EMPTY_EVIDENCE;
        return {
          ...all,
          [stepId]: verdict.accepted
            ? { ...current, accepted: [...current.accepted, edit] }
            : {
                ...current,
                refused: [...current.refused, { edit, refusal: verdict.refusal }],
              },
        };
      });
      if (!verdict.accepted) return;
      /*
       * Only an accepted event reaches the trace (§13). An event that named
       * another track, another Song or another action is a real thing that
       * happened and is worth showing the founder — which is what `refused`
       * is for — but it is not evidence that *this* task was done, and a
       * step that passed on one would be the button-press defect wearing a
       * different name.
       */
      setTraces((all) => {
        const current = all[stepId] ?? EMPTY_TRACE;
        return {
          ...all,
          [stepId]: {
            ...current,
            events: [
              ...current.events,
              { action: edit.action, mutating: edit.mutating },
            ],
          },
        };
      });
      setChainFingerprint(verdict.nextFingerprint);
    });
  }, [envelope, sessionId, session, stepId]);

  const trace = traces[stepId] ?? EMPTY_TRACE;
  const evidence = evidenceByStep[stepId] ?? EMPTY_EVIDENCE;
  const judgement = useMemo<BatchJudgement>(
    () =>
      step ? judgeBatchStep(step.expect, trace) : { passed: false, shortfalls: [] },
    [step, trace],
  );

  const answered = step ? stepAnswered(step.id, answers) : false;
  const mayAdvance = judgement.passed && answered;

  /**
   * Close the round, and assemble the four domains (§4).
   *
   * In the handler that ends the last step rather than in an effect watching
   * for the end: closing the watcher, restoring the clone and reading the
   * result are one action with an order, and an effect would be a second
   * place that could run it.
   */
  const closeRound = useCallback(() => {
    const closed = watch.finish();
    const journalBefore = session?.storage.journal().length ?? 0;
    session?.restore();
    const journalAfter = session?.storage.journal().length ?? 0;
    const after = readFixture(session?.storage ?? EMPTY_STORAGE);

    setIsolation(
      judgeIsolation({
        device: {
          available: watch.available,
          initialBytes: closed.initialBytes,
          finalBytes: closed.finalBytes,
          writes: closed.writes,
          holdsFixtureKey: mentionsFixtureKey(closed.finalBytes),
        },
        fixture: {
          initialBytes: JSON.stringify(session?.initialStorage ?? {}),
          finalBytes: JSON.stringify(session?.storage.snapshot() ?? {}),
          songWrites: session
            ? fixtureSongWrites(session.storage, session.initialJournalLength)
            : 0,
          /* A restore is not an edit, and must not journal as one. */
          restoreJournalEntries: journalAfter - journalBefore,
        },
        record: {
          initialRevision: 1,
          finalRevision: after.revision,
          initialHistoryLength: 1,
          finalHistoryLength: 1,
        },
        guide: {
          sessionId,
          sessionInstalled: session?.ok ?? false,
          cleanup: session ? "clean" : "not_run",
          leftBehind: [],
        },
      }),
    );
  }, [session, sessionId, watch]);

  const finishStep = useCallback(() => {
    if (!step || !session?.ok) return;
    const seen = traces[step.id] ?? EMPTY_TRACE;
    const verdict = judgeBatchStep(step.expect, seen);
    setMeasured((all) => ({ ...all, [step.id]: verdict.passed }));

    /* A write action fills a ledger row (§5). */
    const action = LEDGER_OF[step.id];
    if (action) {
      const commands = seen.events.length;
      const mutations = seen.events.filter((event) => event.mutating).length;
      /*
       * One point per state the record was seen in, with the history depth
       * and the write count that were true at that moment. Nothing here is
       * assumed: `at(index)` reads what the sampler recorded, and a state the
       * founder never produced simply has no point.
       */
      const at = (index: number): TransactionPoint | null => {
        const bytes = seen.states[index];
        if (bytes === undefined) return null;
        return {
          songBytes: bytes,
          songHash: storageHash(bytes),
          revision: seen.revisions[index] ?? 0,
          historyLength: seen.histories?.[index] ?? 1,
          undoDepth: 0,
          redoDepth: 0,
          evalSongWrites: seen.writes?.[index] ?? 0,
          /* The commands belong to the action, not to a sampling moment:
             they are counted across the step and attributed to its `after`. */
          commandCount: index === 0 ? 0 : commands,
          mutatingCommandCount: index === 0 ? 0 : mutations,
        };
      };

      const before = at(0);
      const after = at(1);
      if (before && after) {
        setLedgers((all) => [
          ...all,
          judgeActionLedger({
            action,
            before,
            after,
            undo: at(2),
            redo: at(3),
            /* The clone is put back at the end of the round, not per step, so
               the cleanup point of a step is where that step started. */
            cleanup: before,
          }),
        ]);
      }
    }

    if (stepIndex === BATCH_STEPS.length - 1) closeRound();
    setStepIndex(stepIndex + 1);
    setScreen("song");
  }, [closeRound, session, step, stepIndex, traces]);

  return {
    sessionId,
    screen,
    stepIndex,
    step,
    done,
    envelope,
    support,
    answers,
    evidence,
    judgement,
    answered,
    mayAdvance,
    measured,
    ledgers,
    isolation,
    consoleErrors,
    scopeFilters,
    goToSong: () => setScreen("song"),
    goToTask: () => setScreen("task"),
    answer: (questionId, option) =>
      setAnswers((all) => ({ ...all, [questionId]: option })),
    next: finishStep,
    back: () => {
      if (stepIndex === 0) return;
      const previous = BATCH_STEPS[stepIndex - 1];
      /* Going back re-does the step, so its evidence starts again: a trace
         kept from the first visit would let the second one pass on it. */
      if (previous) {
        setTraces((all) => ({ ...all, [previous.id]: EMPTY_TRACE }));
        setEvidenceByStep((all) => ({ ...all, [previous.id]: EMPTY_EVIDENCE }));
      }
      setStepIndex(stepIndex - 1);
      setScreen("song");
    },
    restart: () => {
      setStepIndex(0);
      setAnswers({});
      setMeasured({});
      setLedgers([]);
      setIsolation(null);
      setTraces({});
      setEvidenceByStep({});
      setScreen("song");
    },
    recordScopeFilter: (id, trackIds) =>
      setScopeFilters((all) =>
        sameFilter(all[id], trackIds) ? all : { ...all, [id]: trackIds },
      ),
  };
}

function sameFilter(
  left: readonly string[] | null | undefined,
  right: readonly string[],
): boolean {
  return (
    left !== null &&
    left !== undefined &&
    left.length === right.length &&
    [...left].sort().join("|") === [...right].sort().join("|")
  );
}

/**
 * The one session id this page has, made on the client and only there.
 *
 * A module singleton: one page is one acceptance session, and a value made
 * again on a second render would be a second name for the same run.
 */
let clientSession: string | null = null;

function clientSessionId(): string {
  clientSession ??= `2vb1-${Math.random().toString(36).slice(2, 10)}`;
  return clientSession;
}

/** Nothing changes it, so there is nothing to subscribe to. */
function subscribeNothing(): () => void {
  return () => {};
}
