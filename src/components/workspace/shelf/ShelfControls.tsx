"use client";

/**
 * The shelf's own small vocabulary of controls (2V-B.4 §17).
 *
 * Four primitives, used by every panel, so that Akor, Hızlı dizi, Süre and
 * Taşı are visibly the same surface rather than four designs that happen to
 * live in the same place. A reader who learns one has learned all of them —
 * which is the whole point of there being one shell.
 *
 * Nothing here is a card. Panels are rows on a shelf, and a card inside a
 * shelf inside a panel is the stack §17 forbids: each border costs the grid
 * pixels and buys the reader nothing.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/** A labelled row of choices that scrolls sideways rather than wrapping. */
export function ShelfRow({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-shelf-row={testId}>
      <span className="text-muted text-[11px]">{label}</span>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">{children}</div>
    </div>
  );
}

/**
 * One choice among several.
 *
 * `reason` is what makes a disabled control honest: it is shown as the
 * control's own title and label, so the reader is told why without pressing
 * anything (§17).
 */
export function ShelfChoice({
  label,
  spoken,
  active = false,
  reason,
  testId,
  onPress,
}: {
  label: string;
  /**
   * What the control is called when the label alone is not a name.
   *
   * A "−" beside "Perde" reads perfectly on the screen and says nothing on
   * its own — and there is a second "−" on the zoom row, so the two would
   * share one accessible name (§17: no two controls with the same name).
   */
  spoken?: string;
  active?: boolean;
  reason?: string;
  testId?: string;
  onPress: () => void;
}) {
  const disabled = reason !== undefined;
  const name = spoken ?? label;
  return (
    <button
      type="button"
      data-shelf-choice={testId}
      data-shelf-choice-state={disabled ? "disabled" : active ? "active" : "idle"}
      disabled={disabled}
      title={reason}
      aria-label={disabled ? `${name} — ${reason}` : name}
      aria-pressed={active}
      onClick={onPress}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`shrink-0 rounded-lg border px-2.5 text-sm whitespace-nowrap ${
        disabled
          ? "border-line/50 text-muted/40"
          : active
            ? "border-bronze bg-bronze/15 text-bronze"
            : "border-line text-muted"
      }`}
    >
      {label}
    </button>
  );
}

/** One line of explanation, beside the action it explains. Never a paragraph. */
export function ShelfNote({
  children,
  tone = "muted",
  testId,
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn";
  testId?: string;
}) {
  return (
    <p
      data-shelf-note={testId}
      role={tone === "warn" ? "status" : undefined}
      className={`text-[11px] ${tone === "warn" ? "text-bronze" : "text-muted"}`}
    >
      {children}
    </p>
  );
}

/**
 * The one loud button on the screen.
 *
 * A panel has at most one. "Dinle" is deliberately not one of these: it is a
 * secondary control beside the primary, because the thing the reader is being
 * asked to decide is whether to keep the edit, not whether to hear it.
 */
export function ShelfPrimary({
  label,
  reason,
  testId,
  onPress,
}: {
  label: string;
  reason?: string;
  testId?: string;
  onPress: () => void;
}) {
  const disabled = reason !== undefined;
  return (
    <button
      type="button"
      data-shelf-primary={testId}
      disabled={disabled}
      title={reason}
      aria-label={disabled ? `${label} — ${reason}` : label}
      onClick={onPress}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`flex-1 rounded-lg px-3 text-sm font-medium ${
        disabled
          ? "border-line/50 text-muted/40 border"
          : "bg-bronze text-app"
      }`}
    >
      {label}
    </button>
  );
}

/** A quiet button beside the primary: Dinle, Kapat, Ayrıntılar. */
export function ShelfSecondary({
  label,
  reason,
  active = false,
  testId,
  onPress,
}: {
  label: string;
  reason?: string;
  active?: boolean;
  testId?: string;
  onPress: () => void;
}) {
  const disabled = reason !== undefined;
  return (
    <button
      type="button"
      data-shelf-secondary={testId}
      disabled={disabled}
      title={reason}
      aria-pressed={active}
      aria-label={disabled ? `${label} — ${reason}` : label}
      onClick={onPress}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`rounded-lg border px-3 text-sm ${
        disabled
          ? "border-line/50 text-muted/40"
          : active
            ? "border-bronze text-bronze"
            : "border-line text-muted"
      }`}
    >
      {label}
    </button>
  );
}
