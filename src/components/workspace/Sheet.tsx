"use client";

/**
 * The bottom sheet every secondary surface uses (spec 13.1).
 *
 * Mobile-first: the main tab surface stays where it is and everything else
 * arrives from the bottom. The sheet is capped at the viewport height and
 * scrolls inside itself, so a long body cannot push its own controls off the
 * screen, and it carries the bottom safe-area inset so the last control is not
 * under the home indicator.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  labelledBy = "sheet-title",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  labelledBy?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <section
        className="bg-panel relative flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-line"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="shrink-0 px-4 pt-3">
          <div className="bg-line mx-auto mb-3 h-1 w-10 rounded-full" />
          <h2 id={labelledBy} className="font-display mb-2 text-lg">
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">{children}</div>
        {footer ? <div className="shrink-0 px-4 pt-3">{footer}</div> : null}
      </section>
    </div>
  );
}

/** A control big enough to hit on a phone. */
export function SheetButton({
  children,
  onClick,
  tone = "neutral",
  disabled = false,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "primary" | "danger";
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled">) {
  const palette =
    tone === "primary"
      ? "border-accept text-accept"
      : tone === "danger"
        ? "border-reject text-reject"
        : "border-line text-text";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 flex-1 rounded-lg border px-3 text-sm disabled:opacity-40 ${palette}`}
      {...rest}
    >
      {children}
    </button>
  );
}
