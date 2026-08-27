/**
 * Which tool the reader is holding (2S-A §6).
 *
 * The editing core already knows how to write a note, move a group, transpose
 * a selection and translate a shape. What it has never had is a way to say
 * *what the reader is trying to do* — so every intent had to be spelled out
 * as a sequence of unrelated errands, and the interface grew a boolean per
 * errand. Five independent booleans is five ways to be in two modes at once.
 *
 * So there is one value, and it is a union. Exactly one tool is held at a
 * time, by construction rather than by discipline, and "no tool" is one of
 * the cases rather than the absence of four.
 *
 * ## What it is not
 *
 * It is **session state and nothing else**. It is never written to the Song,
 * to storage, to the project file, to the fingerprint or to a Copilot
 * request; it does not survive a refresh; it is not an undo step. A tool is
 * what the reader is holding right now, and a reader who comes back tomorrow
 * is holding nothing.
 */

/** The four doors the edit row offers. A door is a place, not a mode. */
export type ComposerDoor = "note" | "shape" | "rhythm" | "connect";

/** How a `connect` tool decides which slur to write. */
export type ConnectionChoice = "auto" | "hammer_on" | "pull_off";

/** What "continue this pattern" does with the selection (2S-A §9). */
export type ContinueMode = "repeat" | "shape" | "pitch";

export type ComposerTool =
  /** Nothing is held; a tap is an ordinary tap. */
  | { readonly kind: "none" }
  /** The plain note entry that has always been there. */
  | { readonly kind: "note" }
  /**
   * The power chord pen: touch a string, get root and fifth at this fret.
   *
   * The fret is part of the tool rather than part of the touch, because a pen
   * is a thing you set up once and then use: the staff's cells are strings and
   * slots, so a tap says *where in time* and *which string* and cannot also
   * say which fret. Set it beside the voice count, tap as many places as you
   * like, and the pen stays what it was.
   */
  | { readonly kind: "power_chord"; readonly voices: 2 | 3; readonly fret: number }
  /** The legato brush: cover a run of onsets and join them. */
  | { readonly kind: "connect"; readonly connection: ConnectionChoice }
  /** Continue the selected pattern, exactly or moved. */
  | { readonly kind: "continue_pattern"; readonly mode: ContinueMode };

export const NO_TOOL: ComposerTool = { kind: "none" };

/** Which door a tool came through. `none` came through none of them. */
export function doorOf(tool: ComposerTool): ComposerDoor | null {
  switch (tool.kind) {
    case "note":
      return "note";
    case "power_chord":
      return "shape";
    case "connect":
      return "connect";
    case "continue_pattern":
      // Continuing a pattern is a rhythmic errand before it is anything else:
      // what carries over is the shape *in time*.
      return "rhythm";
    case "none":
      return null;
  }
}

export function isArmed(tool: ComposerTool): boolean {
  return tool.kind !== "none";
}

/** True when these two are the same tool with the same settings. */
export function sameTool(a: ComposerTool, b: ComposerTool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "power_chord" && b.kind === "power_chord") {
    return a.voices === b.voices && a.fret === b.fret;
  }
  if (a.kind === "connect" && b.kind === "connect") {
    return a.connection === b.connection;
  }
  if (a.kind === "continue_pattern" && b.kind === "continue_pattern") {
    return a.mode === b.mode;
  }
  return true;
}

/**
 * Pick a tool up, or put the one already held down.
 *
 * Choosing the tool that is already held is how a reader lets go of it — the
 * same gesture in both directions, so there is never a state the interface
 * can reach and the reader cannot leave.
 */
export function activate(current: ComposerTool, next: ComposerTool): ComposerTool {
  if (next.kind === "none") return NO_TOOL;
  return sameTool(current, next) ? NO_TOOL : next;
}

/**
 * Why the tool was let go of on its own.
 *
 * All four are the same answer — nothing is held — and they are named so a
 * caller cannot quietly add a fifth case that keeps it.
 */
export type ToolReleaseReason =
  | "track_changed"
  | "section_changed"
  | "project_changed"
  | "editing_ended";

export function releasedOn(reason: ToolReleaseReason): ComposerTool {
  switch (reason) {
    case "track_changed":
    case "section_changed":
    case "project_changed":
    case "editing_ended":
      return NO_TOOL;
  }
}

/* ------------------------------------------------------------- what it says */

const VOICE_LABELS: Readonly<Record<2 | 3, string>> = {
  2: "2 ses",
  3: "3 ses",
};

const CONNECTION_LABELS: Readonly<Record<ConnectionChoice, string>> = {
  auto: "Otomatik bağla",
  hammer_on: "Çekiç (yukarı bağla)",
  pull_off: "Koparma (aşağı bağla)",
};

const CONTINUE_LABELS: Readonly<Record<ContinueMode, string>> = {
  repeat: "Aynen tekrar et",
  shape: "Aynı şekli taşı",
  pitch: "Aynı perdeyi taşı",
};

export const DOOR_LABELS: Readonly<Record<ComposerDoor, string>> = {
  note: "Nota",
  shape: "Şekil",
  rhythm: "Ritim",
  connect: "Bağla",
};

/**
 * What is written on the chip while the tool is held.
 *
 * Turkish, and about music. `hammer_on` is an identifier and never reaches a
 * reader; what reaches them is what a guitarist would say.
 */
export function toolLabel(tool: ComposerTool): string {
  switch (tool.kind) {
    case "none":
      return "";
    case "note":
      return "Nota";
    case "power_chord":
      return `Power chord · ${VOICE_LABELS[tool.voices]} · ${
        tool.fret === 0 ? "boş tel" : `${tool.fret}. perde`
      }`;
    case "connect":
      return CONNECTION_LABELS[tool.connection];
    case "continue_pattern":
      return CONTINUE_LABELS[tool.mode];
  }
}

/**
 * The short form of a held tool, written on the door it came through (K-59).
 *
 * There is no fifth chip. A held tool used to get a strip of its own beside
 * the four doors, which is a control that says something rather than doing
 * something — and on a 320px row it was the width of a door. What the reader
 * needs to know is *which door is holding something and what*, so the door
 * says it: `Şekil` becomes `Power 3`, `Bağla` becomes `Otomatik`.
 *
 * Short on purpose. The full sentence is still the accessible name, so a
 * screen reader hears "Bağla: Otomatik bağla" rather than one clipped word,
 * and no door has to truncate to fit four of them on the narrowest screen.
 */
const SHORT_LABELS: Readonly<Record<ConnectionChoice, string>> = {
  auto: "Otomatik",
  hammer_on: "Çekiç",
  pull_off: "Koparma",
};

const SHORT_CONTINUE: Readonly<Record<ContinueMode, string>> = {
  repeat: "Tekrar",
  shape: "Şekil",
  pitch: "Perde",
};

export function doorLabel(door: ComposerDoor, tool: ComposerTool): string {
  if (doorOf(tool) !== door) return DOOR_LABELS[door];
  switch (tool.kind) {
    case "power_chord":
      return `Power ${tool.voices}`;
    case "connect":
      return SHORT_LABELS[tool.connection];
    case "continue_pattern":
      return SHORT_CONTINUE[tool.mode];
    default:
      return DOOR_LABELS[door];
  }
}

/** The whole sentence, which is never cut for a reader who cannot see it. */
export function doorAccessibleName(
  door: ComposerDoor,
  tool: ComposerTool,
): string {
  if (doorOf(tool) !== door) return DOOR_LABELS[door];
  const held = toolLabel(tool);
  return held ? `${DOOR_LABELS[door]}: ${held}` : DOOR_LABELS[door];
}

/** The one-line explanation under a door's option, for a reader who cannot read notation. */
export const TOOL_HINTS: Readonly<Record<string, string>> = {
  "power_chord:2": "Bastığın perde kök olur, üstüne beşlisi eklenir.",
  "power_chord:3": "Kök, beşlisi ve kökün bir oktav üstü.",
  "connect:auto": "Yükselen notaları çekiçle, alçalanları koparmayla bağlar.",
  "connect:hammer_on": "Sağ elinle tekrar vurmadan daha yüksek notaya geç.",
  "connect:pull_off": "Parmağını çekerek daha alçak notaya geç.",
  "continue_pattern:repeat": "Seçtiğin bölümü olduğu gibi tekrarlar.",
  "continue_pattern:shape": "Aynı parmak şeklini başka perdeye taşır.",
  "continue_pattern:pitch": "Aynı ezgiyi seçtiğin kadar ses yukarı ya da aşağı taşır.",
};

/** The key a tool's hint is stored under. */
export function hintKey(tool: ComposerTool): string {
  switch (tool.kind) {
    case "power_chord":
      return `power_chord:${tool.voices}`;
    case "connect":
      return `connect:${tool.connection}`;
    case "continue_pattern":
      return `continue_pattern:${tool.mode}`;
    default:
      return tool.kind;
  }
}

export function toolHint(tool: ComposerTool): string | null {
  return TOOL_HINTS[hintKey(tool)] ?? null;
}
