"use client";

/**
 * The three choices, on screen (spec 13.20 §2).
 *
 * It opens when an action would cut a tie or a legato chain, before anything
 * happens — no ghost has been computed, nothing has been written, and the
 * command is being held rather than run. Whichever button is pressed is what
 * the core is then told, so what this sheet describes and what gets committed
 * are the same act.
 *
 * Each option says what will happen to the *music*, not what the software will
 * do, and the whole-chain option shows the real widened scope rather than a
 * promise that it is "safe". A reader deciding between two outcomes needs to
 * see both of them.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  CHAIN_SECTION_BLOCKED,
  chainDetachExplain,
  chainImpactTitle,
  chainIncludeExplain,
  chainOptionLabel,
} from "@/lib/song/chain-messages";
import type { ChainDecision } from "@/lib/song/use-transform";
import type { ChainPolicy } from "@/lib/song/chain-preflight";

export function ChainDecisionSheet({
  decision,
  /** The whole chain, already summarised: "3 nota · 2 ölçü". */
  scopeText,
  /** True when the selection is one chord, so the labels can say "akoru". */
  isChord,
  onChoose,
  onCancel,
}: {
  decision: ChainDecision | null;
  scopeText: string;
  isChord: boolean;
  onChoose: (policy: ChainPolicy) => void;
  onCancel: () => void;
}) {
  if (!decision) return null;

  const { impact, command } = decision;
  const blocked = impact.kind === "crosses_section_boundary";

  const option = (policy: ChainPolicy, explain: string) => (
    <button
      type="button"
      data-testid={`chain-option-${policy}`}
      onClick={() => onChoose(policy)}
      className="border-line w-full rounded-lg border px-3 py-2 text-left"
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
    >
      <span className="text-text block text-sm">
        {chainOptionLabel(policy, command.kind, isChord)}
      </span>
      {/* The consequence, not a reassurance. */}
      <span className="text-muted mt-0.5 block text-xs">{explain}</span>
    </button>
  );

  return (
    <Sheet
      open
      title={chainImpactTitle(impact)}
      onClose={onCancel}
      labelledBy="chain-decision-title"
      footer={
        <div className="flex gap-2">
          {/* Cancel is a real answer, and it is the one that changes nothing. */}
          <SheetButton data-testid="chain-option-cancel" onClick={onCancel}>
            Vazgeç
          </SheetButton>
        </div>
      }
    >
      {blocked ? (
        <p data-testid="chain-blocked" className="text-muted text-sm">
          {CHAIN_SECTION_BLOCKED}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {option("include_chain", chainIncludeExplain(scopeText))}
          {option("detach_boundary", chainDetachExplain(impact, isChord))}
        </div>
      )}
    </Sheet>
  );
}
