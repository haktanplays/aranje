"use client";

/**
 * Where a reader sets up a drill (2R-A §14).
 *
 * Three controls and one description. The description is the important part:
 * it says what the loop *is* — a section and a run of bars — and what its
 * edges will do to the music, in bars and notes rather than in this
 * codebase's words for its own bookkeeping.
 *
 * Nothing here computes anything. The bars, the sentences and the offer all
 * arrive decided; this file lays them out and reports taps. That split is why
 * the sheet and the transport cannot disagree about what the loop covers.
 *
 * ## The one thing this screen must never imply
 *
 * That the app is listening. It is not, and the progressive control says so
 * in its own words rather than leaving the reader to assume otherwise from a
 * speed that climbs on its own.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import {
  APPLY_SPEED_LABEL,
  CANCEL_SPEED_LABEL,
  CLEAR_RANGE_LABEL,
  COUNT_IN_LABEL,
  DRAFT_FIELD_LABELS,
  draftFieldValue,
  edgeMessage,
  INCLUDE_CHAIN_LABEL,
  includeChainDetail,
  planRefusalMessage,
  PRACTICE_SHEET_TITLE,
  PROGRESSIVE_EXPLAINER,
  refusalMessage,
  rangeSummary,
  sourceLabel,
  SPEED_LABEL,
  SPEED_MODE_LABELS,
} from "@/lib/practice/messages";
import { COUNT_IN_CHOICES, countInLabel } from "@/lib/practice/count-in";
import { progressiveNotice } from "@/lib/practice/progressive-rate";
import {
  canStep,
  type DraftField,
  type SpeedDraft,
  type SpeedMode,
} from "@/lib/practice/speed-draft";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type {
  PracticeRangeView,
  PracticeSession,
} from "@/lib/workspace/use-practice-session";

const TARGET = { minHeight: MIN_TOUCH_TARGET_PX };
const SQUARE = { minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX };

const SPEED_MODES: readonly SpeedMode[] = ["fixed", "progressive"];
const DRAFT_FIELDS: readonly DraftField[] = [
  "fromPercent",
  "toPercent",
  "incrementPercent",
  "repeatsPerStep",
];

/**
 * One end of one field's control.
 *
 * Disabled at the field's own limit rather than silently refusing to move:
 * the reader can see where the range ends before pressing into it (§X).
 */
function Nudge({
  field,
  direction,
  draft,
  onPress,
}: {
  field: DraftField;
  direction: 1 | -1;
  draft: SpeedDraft;
  onPress: (field: DraftField, direction: 1 | -1) => void;
}) {
  const word = direction === 1 ? "artır" : "azalt";
  return (
    <button
      type="button"
      data-speed-step={`${field}:${direction}`}
      aria-label={`${DRAFT_FIELD_LABELS[field]} ${word}`}
      disabled={!canStep(draft, field, direction)}
      onClick={() => onPress(field, direction)}
      style={SQUARE}
      className="border-line text-text rounded-lg border text-base disabled:opacity-40"
    >
      <span aria-hidden>{direction === 1 ? "+" : "−"}</span>
    </button>
  );
}

export function PracticeSheet({
  open,
  onClose,
  session,
  view,
}: {
  open: boolean;
  onClose: () => void;
  session: PracticeSession;
  /** Null when no bars are chosen yet. */
  view: PracticeRangeView | null;
}) {
  const edge = session.preflight ? edgeMessage(session.preflight.kind) : null;
  const notice = progressiveNotice(session.progressive);

  return (
    <Sheet open={open} title={PRACTICE_SHEET_TITLE} onClose={onClose}>
      <div data-practice-sheet className="space-y-4 pb-2">
        {/* ---------------------------------------------- what is looping */}
        <section>
          {view === null ? (
            <>
              <p data-practice-empty className="text-muted text-sm">
                Bir ölçü seç ve o ölçüyü döngüye al. Aynı bölümde ikinci bir
                ölçü seçersen aradaki her şey döngüye girer.
              </p>
              {session.currentBarKey ? (
                <div className="mt-3">
                  <SheetButton
                    data-practice-current
                    tone="primary"
                    onClick={() => session.selectBar(session.currentBarKey!)}
                  >
                    Bulunduğun ölçüyü çalış
                  </SheetButton>
                </div>
              ) : (
                <p data-practice-no-bar className="text-muted mt-2 text-xs">
                  Önce çal — döngüye alınacak ölçü, çalarken bulunduğun ölçüdür.
                </p>
              )}
            </>
          ) : (
            <>
              <p data-practice-range className="text-text text-sm">
                {rangeSummary(view.firstBarNumber, view.lastBarNumber, view.sectionName)}
              </p>
              {session.source ? (
                <p data-practice-source className="text-muted text-[11px]">
                  {sourceLabel(session.source)}
                </p>
              ) : null}
            </>
          )}

          {session.refusal ? (
            <p data-practice-refusal role="alert" className="text-reject mt-2 text-xs">
              {refusalMessage(session.refusal)}
            </p>
          ) : null}

          {/*
            What the edges cut. A description, not a warning: looping into the
            middle of a held note is a reasonable thing to do on purpose, and
            the reader is the one who decides whether they meant it.
          */}
          {edge ? (
            <p data-practice-edge role="status" className="text-bronze mt-2 text-xs">
              {edge}
            </p>
          ) : null}

          {session.preflight?.widened && view?.widened ? (
            <div className="mt-2 space-y-1">
              <SheetButton data-practice-include onClick={session.acceptWidened}>
                {INCLUDE_CHAIN_LABEL}
              </SheetButton>
              <p className="text-muted text-[11px]">
                {includeChainDetail(
                  view.widened.firstBarNumber,
                  view.widened.lastBarNumber,
                )}
              </p>
            </div>
          ) : null}

          {view !== null ? (
            <div className="mt-3 space-y-1.5">
              {/*
                The second door (§V.A). One end is already chosen, so naming
                the other one is a range — in either order, because the reader
                may well have moved backwards to find it.
              */}
              {session.currentBarKey ? (
                <SheetButton
                  data-practice-extend
                  onClick={() => session.extendTo(session.currentBarKey!)}
                >
                  Bulunduğun ölçüye kadar uzat
                </SheetButton>
              ) : null}
              <SheetButton data-practice-clear onClick={session.clear}>
                {CLEAR_RANGE_LABEL}
              </SheetButton>
            </div>
          ) : null}
        </section>

        {/* ------------------------------------------------- the count-in */}
        <section>
          <p className="text-muted mb-1.5 text-xs">{COUNT_IN_LABEL}</p>
          <div role="group" aria-label={COUNT_IN_LABEL} className="flex gap-1.5">
            {COUNT_IN_CHOICES.map((bars) => (
              <button
                key={bars}
                type="button"
                data-count-in={bars}
                aria-pressed={session.countInBars === bars}
                onClick={() => session.setCountIn(bars)}
                style={TARGET}
                className={`flex-1 rounded-lg border px-2 text-sm ${
                  session.countInBars === bars
                    ? "border-bronze text-bronze"
                    : "border-line text-muted"
                }`}
              >
                {countInLabel(bars)}
              </button>
            ))}
          </div>
        </section>

        {/* --------------------------------------------- getting faster */}
        <section>
          <p className="text-muted mb-1.5 text-xs">{SPEED_LABEL}</p>
          {/*
            Two modes, said in words rather than by whether a panel happens to
            be showing. `aria-pressed` carries the same fact to a screen
            reader, and the chosen one is marked by its label *and* its
            border — a state told only in colour is a state some readers do
            not have (§X).
          */}
          <div role="group" aria-label={SPEED_LABEL} className="flex gap-1.5">
            {SPEED_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                data-speed-mode={mode}
                aria-pressed={session.speedMode === mode}
                onClick={() => session.setSpeedMode(mode)}
                style={TARGET}
                className={`flex-1 rounded-lg border px-2 text-sm ${
                  session.speedMode === mode
                    ? "border-bronze text-bronze"
                    : "border-line text-muted"
                }`}
              >
                {SPEED_MODE_LABELS[mode]}
                {session.speedMode === mode ? " ✓" : ""}
              </button>
            ))}
          </div>

          {session.speedMode === "progressive" ? (
            <div className="mt-3 space-y-2">
              <p data-progressive-explainer className="text-muted text-[11px]">
                {PROGRESSIVE_EXPLAINER}
              </p>

              {/*
                The four numbers. Only here: in "Sabit" they are not dimmed,
                they are absent, because a control that is visible and does
                nothing is a promise the screen is not keeping.
              */}
              {DRAFT_FIELDS.map((field) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-muted flex-1 text-xs">
                    {DRAFT_FIELD_LABELS[field]}
                  </span>
                  <Nudge
                    field={field}
                    direction={-1}
                    draft={session.speedDraft}
                    onPress={session.nudgeSpeed}
                  />
                  <span
                    data-speed-value={field}
                    aria-live="polite"
                    className="text-text w-20 text-center font-mono text-sm tabular-nums"
                  >
                    {draftFieldValue(field, session.speedDraft[field])}
                  </span>
                  <Nudge
                    field={field}
                    direction={1}
                    draft={session.speedDraft}
                    onPress={session.nudgeSpeed}
                  />
                </div>
              ))}

              {session.planRefusal ? (
                <p data-speed-refusal role="alert" className="text-reject text-xs">
                  {planRefusalMessage(session.planRefusal)}
                </p>
              ) : null}

              {notice ? (
                <p data-progressive-notice role="status" className="text-text text-sm">
                  {notice}
                </p>
              ) : null}

              <div className="flex gap-1.5">
                <div className="flex-1">
                  <SheetButton
                    data-progressive-start
                    tone="primary"
                    onClick={() => session.applySpeed()}
                  >
                    {APPLY_SPEED_LABEL}
                  </SheetButton>
                </div>
                <div className="flex-1">
                  <SheetButton data-speed-cancel onClick={session.cancelSpeedDraft}>
                    {CANCEL_SPEED_LABEL}
                  </SheetButton>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Sheet>
  );
}
