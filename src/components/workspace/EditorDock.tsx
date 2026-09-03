"use client";

/**
 * The one shelf of local editing tools (2W §8, §9).
 *
 * ## The invariant this component exists to keep
 *
 * **It never covers the grid.** It is an ordinary block in the editor's
 * vertical flow — no `fixed`, no `absolute`, no scrim, no full-screen sheet —
 * so the music above it keeps its own height and stays hit-testable while the
 * shelf is open. A browser check reads `elementFromPoint` at the grid's centre
 * and requires the grid itself to answer.
 *
 * ## Two states, one row tall each
 *
 * Compact: the four group names. Expanded: the four group names plus the
 * chosen group's controls underneath. Expanding costs one row of buttons and
 * gives the reader the tools; it does not move the grid's top edge, does not
 * clear the selection, and does not scroll anything.
 *
 * ## Where it replaced two rows
 *
 * `ComposerDoorRow` and `SelectionToolbar` used to take turns on this line —
 * doors with nothing selected, verbs with something selected — so the row
 * changed identity under the reader's finger. Now the four words are constant
 * and only what is inside them changes.
 */
import { useState } from "react";

import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  DOCK_GROUPS,
  DOCK_GROUP_LABEL,
  dockGroupItems,
  dockReason,
  type DockGroup,
  type DockItem,
  type DockModel,
} from "@/lib/workspace/editor-dock";

export function EditorDock({
  model,
  notice,
  error,
  onRun,
  panels,
  panel,
  panelTitle,
  onPanel,
}: {
  model: DockModel;
  notice: string | null;
  error: string | null;
  onRun: (itemId: string) => void;
  /**
   * The rich controls each group offers, as entry buttons (2V-B.4 §4).
   *
   * They sit beside the group's ordinary verbs rather than in a menu of their
   * own, because a reader looking for "Akor" is looking under "Ses" and
   * should find it there next to everything else that makes a sound.
   */
  panels: readonly {
    readonly id: string;
    readonly group: DockGroup;
    readonly label: string;
    readonly reason?: string;
  }[];
  /** The open panel's body, rendered in the flow. Never over the grid. */
  panel: React.ReactNode;
  panelTitle: string | null;
  onPanel: (id: string | null) => void;
}) {
  const [open, setOpen] = useState<DockGroup | null>(null);
  const items = open === null ? [] : dockGroupItems(model, open);
  const groupPanels = open === null ? [] : panels.filter((entry) => entry.group === open);

  return (
    <section
      data-editor-dock
      data-editor-dock-open={open ?? ""}
      aria-label="Düzenleme araçları"
      className="border-line flex flex-col gap-1 border-t px-3 py-1"
    >
      {error ? (
        <p data-dock-error role="alert" className="text-reject text-[11px]">
          {error}
        </p>
      ) : null}
      {!error && notice ? (
        <p data-dock-notice role="status" className="text-muted text-[11px]">
          {notice}
        </p>
      ) : null}

      <div
        role="tablist"
        aria-label="Araç grupları"
        className="flex gap-1.5"
      >
        {DOCK_GROUPS.map((group) => {
          const available =
            model.groups.includes(group) ||
            panels.some((entry) => entry.group === group && entry.reason === undefined);
          /* A group with no verbs may still have a panel — "Akor" lives under
             Ses whether or not anything is selected — so availability is the
             union of the two rather than the verbs alone. */
          const active = open === group;
          return (
            <button
              key={group}
              type="button"
              role="tab"
              data-dock-group={group}
              aria-selected={active}
              disabled={!available}
              onClick={() => {
                setOpen(active ? null : group);
                onPanel(null);
              }}
              style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: 56 }}
              className={`min-w-0 flex-1 rounded-lg border px-1.5 text-sm whitespace-nowrap ${
                !available
                  ? "border-line/40 text-muted/40"
                  : active
                    ? "border-bronze bg-bronze/15 text-bronze font-medium"
                    : "border-line text-muted"
              }`}
            >
              {DOCK_GROUP_LABEL[group]}
            </button>
          );
        })}
      </div>

      {panelTitle ? (
        <div
          data-shelf-panel={panelTitle}
          /*
           * In the flow, and scrolling inside itself when it is taller than
           * the room it has. This is the whole difference from the sheet it
           * replaced: no `fixed`, no scrim, no 85% of the screen — the grid
           * above keeps its pixels and stays hit-testable (§4, §17).
           */
          className="border-line/60 flex max-h-[42dvh] flex-col gap-2 overflow-y-auto border-t pt-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-text text-sm font-medium">{panelTitle}</span>
            <button
              type="button"
              data-shelf-panel-close
              onClick={() => onPanel(null)}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              className="border-line text-muted rounded-lg border px-3 text-sm"
            >
              Kapat
            </button>
          </div>
          {panel}
        </div>
      ) : null}

      {panelTitle === null && groupPanels.length > 0 ? (
        <div data-dock-panels={open ?? ""} className="flex gap-1.5 overflow-x-auto">
          {groupPanels.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-dock-panel={entry.id}
              disabled={entry.reason !== undefined}
              title={entry.reason}
              aria-label={
                entry.reason === undefined ? entry.label : `${entry.label} — ${entry.reason}`
              }
              onClick={() => onPanel(entry.id)}
              style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: 88 }}
              className={`min-w-0 shrink-0 flex-1 rounded-lg border px-2 text-sm whitespace-nowrap ${
                entry.reason === undefined
                  ? "border-bronze/60 text-bronze"
                  : "border-line/50 text-muted/40"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      {panelTitle === null && items.length > 0 ? (
        <div
          data-dock-items={open ?? ""}
          role="group"
          aria-label={open === null ? undefined : DOCK_GROUP_LABEL[open]}
          /*
           * One row that scrolls sideways rather than a block that wraps.
           * Wrapping is what would let a group with six controls push the
           * grid up, and the grid's height is the invariant this whole
           * component exists to keep.
           */
          className="flex gap-1.5 overflow-x-auto"
        >
          {items.map((item) => (
            <DockButton key={item.id} item={item} onRun={onRun} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DockButton({
  item,
  onRun,
}: {
  item: DockItem;
  onRun: (itemId: string) => void;
}) {
  const why = dockReason(item);
  return (
    <button
      type="button"
      data-dock-item={item.id}
      data-dock-item-state={item.state}
      disabled={why !== null}
      /*
       * The reason travels with the control, not with a press. A grey button
       * that explains itself teaches; one that stays silent until pressed
       * teaches nothing and reads as broken (2W §14).
       */
      title={why ?? undefined}
      aria-label={why === null ? undefined : `${item.label} — ${why}`}
      aria-pressed={item.held === true ? true : undefined}
      onClick={() => onRun(item.id)}
      style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: 72 }}
      className={`min-w-0 shrink-0 flex-1 rounded-lg border px-2 text-sm whitespace-nowrap ${
        why !== null
          ? "border-line/50 text-muted/40"
          : item.held === true
            ? "border-bronze bg-bronze/15 text-bronze"
            : "border-line text-muted"
      }`}
    >
      {item.label}
    </button>
  );
}
