"use client";

/**
 * Which sheet is on top (2L-R).
 *
 * One discriminated value instead of five independent booleans, because the
 * sheets are modal: only one can be interacted with at a time, and a state
 * that can *say* two are open is a state someone eventually gets into. The
 * observable behaviour is unchanged — every open replaced whatever was
 * showing anyway (the info sheet already closed itself to open the project
 * sheet), this just makes the mutual exclusion a property of the type.
 *
 * The transform sheet, the bar sheets, the Copilot sheets and the fret sheet
 * are not here: each belongs to the session that owns its state, and moving
 * only their `open` flags into this enum would split one concern across two
 * owners.
 */
import { useCallback, useState } from "react";

export type WorkspaceSheet =
  | "track"
  | "section"
  | "practice"
  | "info"
  | "project"
  /* The lifecycle sheets (2L-B): same modal family, same single owner. */
  | "newSong"
  | "songInfo"
  | "sectionManage"
  | "trackManage"
  /* The mixer (2L-C): same modal family, same single owner. */
  | "mixer"
  /* Getting the song out of the app (2M-A). */
  | "export";

export type WorkspaceOverlayState = {
  readonly sheet: WorkspaceSheet | null;
  isOpen(sheet: WorkspaceSheet): boolean;
  open(sheet: WorkspaceSheet): void;
  close(): void;
};

export function useWorkspaceOverlays(): WorkspaceOverlayState {
  const [sheet, setSheet] = useState<WorkspaceSheet | null>(null);

  const isOpen = useCallback((name: WorkspaceSheet) => sheet === name, [sheet]);
  const open = useCallback((name: WorkspaceSheet) => setSheet(name), []);
  const close = useCallback(() => setSheet(null), []);

  return { sheet, isOpen, open, close };
}
