/**
 * One shelf for every local editing tool, in one vocabulary (2W §8, §9).
 *
 * ## What was wrong, measured
 *
 * At `28d8849` the editor's local tools were two rows that never appeared
 * together — `[data-composer-doors]` at 48 px with nothing selected, and
 * `[data-selection-toolbar]` at 49 px with something selected. Measured at
 * five viewports, they do **not** stack, and the grid keeps 320 px either
 * way. So the problem was never vertical pixels.
 *
 * The problem is that they are two unrelated *worlds*. Tapping a cell gives
 * four intent doors — Nota, Şekil, Ritim, Bağla — and long-pressing a range
 * gives seven verbs — Kopyala, Kes, Çoğalt, Tekrarla, Taşı, Sil, Daha fazla.
 * Same line of the screen, same finger, entirely different mental model, and
 * a "Şekil" whose name says nothing about what is behind it. A reader who
 * learns one has not learned the other.
 *
 * ## The vocabulary
 *
 * Four groups, always in this order, and every local tool belongs to exactly
 * one of them:
 *
 * - **Ses** — what sounds here: a note, a power chord, a chord, a rest.
 * - **Ritim** — how long, and how it repeats: duration, "Devam", tekrar.
 * - **Çalım** — how it is played: legato, palm mute, slide, vibrato, strum.
 * - **Seçim** — what to do with what is held: listen, loop, clipboard, move,
 *   delete, connect.
 *
 * The groups are constant; their *contents* change with what is held. That is
 * the difference from the two-row design, where the whole row changed
 * identity: here the reader always sees the same four words and learns where
 * things live.
 *
 * ## Pure
 *
 * No React, no DOM, no Song mutation. It answers "what does the shelf show
 * right now" from the capability model's own offers and from which tool is
 * held. Every disabled item carries the model's own sentence, so a greyed
 * control can always say why — which is §14's requirement and impossible to
 * satisfy from a component that invented its own list.
 */
import {
  doorLabel,
  doorOf,
  type ComposerDoor,
  type ComposerTool,
} from "@/lib/workspace/composer-tool";
import type {
  SelectionActionId,
  SelectionActionOffer,
} from "@/lib/song/selection-action-canon";

export type DockGroup = "ses" | "ritim" | "calim" | "secim";

/** The four words, in the order they are always drawn. */
export const DOCK_GROUPS: readonly DockGroup[] = ["ses", "ritim", "calim", "secim"];

export const DOCK_GROUP_LABEL: Readonly<Record<DockGroup, string>> = {
  ses: "Ses",
  ritim: "Ritim",
  calim: "Çalım",
  secim: "Seçim",
};

/**
 * Where each selection verb lives.
 *
 * "Devam" is rhythm rather than selection: it makes the held run longer,
 * which is a question about how long the music is, not about what to do with
 * a clipboard. "Bağla" is playing — it is how two notes are sounded, which is
 * the same shelf as legato and slide.
 */
const ACTION_GROUP: Readonly<Record<SelectionActionId, DockGroup>> = {
  copy: "secim",
  cut: "secim",
  duplicate: "secim",
  repeat: "ritim",
  move: "secim",
  delete: "secim",
  extend: "ritim",
  connect: "calim",
  paste: "secim",
  listen_once: "secim",
  listen_loop: "secim",
  more: "secim",
};

/** Where each intent door lives. */
const DOOR_GROUP: Readonly<Record<ComposerDoor, DockGroup>> = {
  note: "ses",
  /* The old "Şekil" — a word that named no musical thing. What is behind it
     is the power chord pen and the chord builder, which are both sounds. */
  shape: "ses",
  rhythm: "ritim",
  connect: "calim",
};

export type DockItem = {
  readonly id: string;
  readonly label: string;
  readonly group: DockGroup;
  readonly kind: "door" | "action";
  readonly state: "available" | "disabled";
  /** Present exactly when disabled: the model's own sentence, for the reader. */
  readonly reason?: string;
  /** True for the door whose tool is currently held. */
  readonly held?: boolean;
};

export type DockModel = {
  readonly items: readonly DockItem[];
  /** Groups that have at least one item, in canonical order. */
  readonly groups: readonly DockGroup[];
  /**
   * Which group opens first when the shelf has nothing open yet.
   *
   * Whatever the reader's last gesture was about: holding a run makes Seçim
   * the obvious shelf, and holding a tool makes that tool's own shelf so.
   */
  readonly suggested: DockGroup | null;
};

/**
 * The shelf, from the same two sources the two old rows read separately.
 *
 * `offers` is the capability model's answer — the identical list the
 * selection toolbar drew — and `tool` is the intent layer's held tool. There
 * is no third source, and nothing here decides whether an action is allowed:
 * a disabled item is disabled because the model said so, and carries the
 * model's reason.
 */
export function editorDock(input: {
  readonly offers: readonly SelectionActionOffer[];
  readonly tool: ComposerTool;
  /** True when the reader is holding a run of music. */
  readonly hasSelection: boolean;
  /** Doors the surface can actually open here; absent means all four. */
  readonly doors?: readonly ComposerDoor[];
}): DockModel {
  const held = doorOf(input.tool);
  const doors = input.doors ?? (["note", "shape", "rhythm", "connect"] as const);

  const items: DockItem[] = [
    ...doors.map((door) => ({
      id: `door:${door}`,
      label: doorLabel(door, input.tool),
      group: DOOR_GROUP[door],
      kind: "door" as const,
      state: "available" as const,
      ...(held === door ? { held: true } : {}),
    })),
    ...input.offers.map((offer) => ({
      id: `action:${offer.id}`,
      label: offer.label,
      group: ACTION_GROUP[offer.id],
      kind: "action" as const,
      state: offer.availability,
      ...(offer.reason === undefined ? {} : { reason: offer.reason }),
    })),
  ];

  const groups = DOCK_GROUPS.filter((group) =>
    items.some((item) => item.group === group),
  );

  /*
   * A held tool wins over a held selection: the reader picked the tool more
   * recently than the app decided they had a run. With neither, Ses — the
   * shelf a blank bar is waiting for.
   */
  const suggested =
    held !== null
      ? DOOR_GROUP[held]
      : input.hasSelection && groups.includes("secim")
        ? "secim"
        : (groups[0] ?? null);

  return { items, groups, suggested };
}

/** The items of one group, doors before verbs so the shelf reads the same way. */
export function dockGroupItems(
  model: DockModel,
  group: DockGroup,
): readonly DockItem[] {
  return model.items.filter((item) => item.group === group);
}

/**
 * Why this control cannot be pressed, or null.
 *
 * A separate function rather than a field read inline, because "disabled with
 * no reason" is the state §14 forbids and this is where it is caught: an item
 * that is disabled and silent returns a sentence saying so rather than
 * nothing, so the screen can never draw a grey button that explains nothing.
 */
export function dockReason(item: DockItem): string | null {
  if (item.state !== "disabled") return null;
  return item.reason ?? "Şu anda kullanılamıyor.";
}
