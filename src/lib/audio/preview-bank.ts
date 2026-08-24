"use client";

/**
 * The session that keeps auditioned samples decoded (2O-B.1 §3).
 *
 * An audition is a whole engine built, played once and thrown away. That is
 * the right shape — there is one scheduler, one articulation path and one
 * idea of what a chord sounds like, because the preview *is* playback — but
 * it meant the decoded sample bank died with each engine and the next
 * audition decoded the same seven files again.
 *
 * This is the one owner of the fix. It holds nothing itself: it opens
 * retention on whichever context an engine turns out to have been built on,
 * and the bank cache does the rest. Retention is per context, so every
 * preview running on the live context — a chord audition, a Copilot
 * candidate — shares the same retained banks without having to be told about
 * each other.
 *
 * What it must never do is outlive the screen. `dispose` closes every
 * retention it opened, and the banks go with it.
 */
import { openBankRetention, type BankRetention } from "@/lib/audio/buffer-bank";
import type { AudioRuntime } from "@/lib/audio/engine";

export class PreviewBankSession {
  private readonly retentions = new Map<AudioRuntime, BankRetention>();
  private disposed = false;

  /**
   * Start keeping banks on this context. Idempotent: called on every engine
   * build, and the second call onwards is nothing.
   */
  open(context: AudioRuntime): void {
    if (this.disposed || this.retentions.has(context)) return;
    this.retentions.set(context, openBankRetention(context));
  }

  /** How many banks are being held for the session. Diagnostics and tests. */
  retained(): number {
    let total = 0;
    for (const retention of this.retentions.values()) total += retention.retained();
    return total;
  }

  /** Whether this session is still keeping anything. Diagnostics and tests. */
  get contexts(): number {
    return this.retentions.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const retention of this.retentions.values()) retention.dispose();
    this.retentions.clear();
  }
}
