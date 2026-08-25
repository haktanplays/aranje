"use client";

/**
 * Where each section begins, on a surface that draws all of them (2Q-C §4).
 *
 * The Çoklu view became one continuous surface in this checkpoint, which
 * removed the thing that used to say which section the reader was in: there
 * was one section on screen and its name was in the header. A continuous
 * surface with no marks is a wall of bars, so the boundary is drawn where it
 * musically is — a line between two bars — rather than being announced
 * somewhere else.
 *
 * Not windowed, deliberately. There is one span per section and the contract
 * caps a song at four; mounting them all costs a handful of nodes and means
 * the label for the section the reader is entering is already there rather
 * than arriving a frame after the bars do.
 */
import { STAFF_TOP_PADDING } from "@/components/workspace/geometry";
import type { SectionStatus } from "@/lib/song/schema";
import type { SongAxis } from "@/lib/tab/song-axis";

/**
 * Spec 13.6: bronze marks an AI suggestion, green an accepted one; a settled
 * section stays neutral so gold does not end up on every bar.
 *
 * Here rather than in either canvas, because both draw it and two colour
 * tables is how a section comes to be bronze on one surface and grey on the
 * other.
 */
export function sectionAccent(status: SectionStatus): string {
  if (status === "pending") return "bg-bronze";
  if (status === "accepted") return "bg-accept";
  return "bg-muted/60";
}

export function sectionText(status: SectionStatus): string {
  if (status === "pending") return "text-bronze";
  if (status === "accepted") return "text-accept";
  return "text-muted";
}

export type MarkedSection = {
  readonly id: string;
  readonly name: string;
  readonly status: SectionStatus;
};

export function SectionMarkers({
  axis,
  sections,
  height,
}: {
  axis: SongAxis;
  /** Names and statuses, which are facts about the song and not about pixels. */
  sections: readonly MarkedSection[];
  /** How far down the accent line runs. The top padding alone by default. */
  height?: number;
}) {
  return (
    <div
      aria-hidden
      data-section-markers
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{ height: height ?? STAFF_TOP_PADDING }}
    >
      {sections.map((section) => {
        const placed = axis.sections.find(
          (entry) => entry.sectionId === section.id,
        );
        if (!placed) return null;
        return (
          <span
            key={section.id}
            data-section-marker={section.id}
            className={`absolute bottom-0 text-[9px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase ${sectionText(
              section.status,
            )}`}
            style={{ left: placed.leftPx + 4 }}
          >
            {section.name}
          </span>
        );
      })}
    </div>
  );
}
