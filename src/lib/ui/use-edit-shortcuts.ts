"use client";

/**
 * Undo and redo from a keyboard (spec 13.13, K-44).
 *
 * The app is built for a phone, where there is no keyboard and these never
 * fire. They exist because the same page opens on a laptop, and on a laptop
 * Ctrl+Z is not a feature — it is what the reader's hands do without asking.
 *
 * Three rules, and each of them exists because breaking it is worse than not
 * having the shortcut at all:
 *
 * - **Not while typing.** A song title being renamed has its own undo, the
 *   one the browser gives every text field. Stealing Ctrl+Z there would throw
 *   away a word and step the *song* back instead, which is the least
 *   recoverable thing this app could do to someone mid-sentence.
 * - **Only when there is something to do.** `preventDefault` on a key the app
 *   is going to ignore takes the shortcut away from the browser for nothing.
 *   With an empty history, Ctrl+Z stays the browser's.
 * - **Both spellings of redo.** Ctrl+Shift+Z is what the Mac and most editors
 *   use; Ctrl+Y is what Windows users reach for. Supporting one and not the
 *   other is a coin flip on whether the reader's habit works.
 */
import { useEffect } from "react";

/** Is the reader typing into something that owns its own undo? */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useEditShortcuts({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Cmd on a Mac, Ctrl everywhere else. Alt is somebody else's shortcut.
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (isTextEntry(event.target)) return;

      const key = event.key.toLowerCase();
      const wantsRedo = (key === "z" && event.shiftKey) || key === "y";
      const wantsUndo = key === "z" && !event.shiftKey;
      if (!wantsRedo && !wantsUndo) return;

      // Nothing to do means nothing to swallow: the browser keeps the key.
      if (wantsRedo ? !canRedo : !canUndo) return;

      event.preventDefault();
      if (wantsRedo) onRedo();
      else onUndo();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRedo, canUndo, onRedo, onUndo]);
}
