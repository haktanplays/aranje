"use client";

/**
 * One project, as a reader recognises it (2V-E.1 §4).
 *
 * The whole card is the control, because "open this project" is the only
 * thing a row on Home does — a card with a separate small "Aç" button would
 * be two targets for one intention, and the small one would be the one that
 * misses on a phone.
 */
import type { HomeCard } from "@/lib/home/home-model";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export function ProjectCard({
  card,
  onOpen,
  emphasis = false,
}: {
  card: HomeCard;
  onOpen: (id: string) => void;
  /** The open project is drawn a little louder than the rest of the list. */
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      data-home-card={card.id}
      data-home-card-active={card.isActive ? "yes" : "no"}
      aria-label={card.label}
      disabled={card.unreadable}
      onClick={() => onOpen(card.id)}
      style={{ minHeight: MIN_TOUCH_TARGET_PX + 20 }}
      className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-3 text-left disabled:opacity-60 ${
        emphasis ? "border-bronze/60 bg-bronze/10" : "border-line"
      }`}
    >
      <span className="font-display truncate text-base leading-tight">{card.title}</span>
      {card.musicLine ? (
        <span className="text-muted truncate text-xs tabular-nums">{card.musicLine}</span>
      ) : null}
      <span className="text-muted truncate text-xs">{card.shapeLine}</span>
      {card.whenLine ? (
        <span className="text-muted/80 truncate text-[11px]">{card.whenLine}</span>
      ) : null}
    </button>
  );
}
