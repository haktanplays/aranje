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
  CLEAR_RANGE_LABEL,
  COUNT_IN_LABEL,
  edgeMessage,
  INCLUDE_CHAIN_LABEL,
  includeChainDetail,
  PRACTICE_SHEET_TITLE,
  PROGRESSIVE_EXPLAINER,
  PROGRESSIVE_LABEL,
  refusalMessage,
  rangeSummary,
  sourceLabel,
} from "@/lib/practice/messages";
import { COUNT_IN_CHOICES, countInLabel } from "@/lib/practice/count-in";
import { progressiveNotice } from "@/lib/practice/progressive-rate";
import { practiceRateLimits, progressiveRateLimits } from "@/lib/limits";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type {
  PracticeRangeView,
  PracticeSession,
} from "@/lib/workspace/use-practice-session";

const TARGET = { minHeight: MIN_TOUCH_TARGET_PX };

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
          <p className="text-muted mb-1.5 text-xs">{PROGRESSIVE_LABEL}</p>
          <p data-progressive-explainer className="text-muted mb-2 text-[11px]">
            {PROGRESSIVE_EXPLAINER}
          </p>
          {session.progressive === null ? (
            <SheetButton
              data-progressive-start
              onClick={() =>
                session.startProgressiveRate({
                  fromPercent:
                    practiceRateLimits.defaultPercent - 4 * practiceRateLimits.stepPercent,
                  toPercent: practiceRateLimits.defaultPercent,
                  repeatsPerStep: progressiveRateLimits.defaultRepeatsPerStep,
                })
              }
            >
              %80&apos;den %100&apos;e başlat
            </SheetButton>
          ) : (
            <div className="space-y-1.5">
              {notice ? (
                <p data-progressive-notice role="status" className="text-text text-sm">
                  {notice}
                </p>
              ) : null}
              <SheetButton data-progressive-stop onClick={session.stopProgressiveRate}>
                Kademeli hızlanmayı bırak
              </SheetButton>
            </div>
          )}
        </section>
      </div>
    </Sheet>
  );
}
