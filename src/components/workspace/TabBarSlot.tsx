"use client";

/**
 * One bar of the tab, with the marks that say where a section begins.
 *
 * Split out of `TabCanvas` in 2Q-C: the canvas gained a windowing model, a
 * follow model and a whole-song axis, and the thing that had to give was the
 * part of it that was never about any of those. A bar's frame is a frame
 * whether the bar is mounted by a window or drawn all at once.
 *
 * The section accent and its name are drawn here, on the bar that starts the
 * section, rather than in a separate layer: the mark belongs to the bar line
 * it is a mark about, so it arrives and leaves with the bar under windowing
 * without anything having to keep the two in step.
 */
import {
  sectionAccent,
  sectionText,
} from "@/components/workspace/SectionMarkers";
import type { DrumBar, FrettedBar } from "@/lib/tab/timeline";

/** Two letters per drum lane, in the gutter. Never the raw piece id. */
export const DRUM_LABEL: Record<string, string> = {
  crash: "CR",
  china: "CH",
  ride: "RD",
  open_hat: "OH",
  closed_hat: "HH",
  tom_high: "T1",
  tom_mid: "T2",
  tom_floor: "FT",
  snare: "SN",
  kick: "BD",
};

/** True when this track writes nothing anywhere in the section. */
function sectionIsSilent(
  bars: readonly (FrettedBar | DrumBar)[],
  sectionId: string,
): boolean {
  const inSection = bars.filter((bar) => bar.sectionId === sectionId);
  return inSection.length > 0 && inSection.every((bar) => bar.silent);
}

/** Wraps a bar with its section marker and, at a section start, its name. */
export function BarSlot({
  bar,
  bars,
  children,
}: {
  bar: FrettedBar | DrumBar;
  bars: readonly (FrettedBar | DrumBar)[];
  children: React.ReactNode;
}) {
  return (
    <div data-bar-key={bar.key} className="relative">
      {bar.isSectionStart ? (
        <>
          <span
            aria-hidden
            className={`absolute top-0 bottom-0 left-0 z-10 w-0.5 ${sectionAccent(
              bar.sectionStatus,
            )}`}
          />
          <span
            className={`absolute -top-5 left-1.5 text-[9px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase ${sectionText(
              bar.sectionStatus,
            )}`}
          >
            {bar.sectionName}
            {sectionIsSilent(bars, bar.sectionId) ? (
              <span className="text-muted/60 ml-1.5 tracking-normal normal-case">
                (bu track susuyor)
              </span>
            ) : null}
          </span>
        </>
      ) : null}
      {children}
    </div>
  );
}
