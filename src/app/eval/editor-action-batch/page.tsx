import type { Metadata } from "next";

import { BRAND_NAME } from "@/lib/brand";

import { EditorActionBatch } from "@/components/acceptance/EditorActionBatch";

/**
 * A developer diagnostic. **Not a founder gate** (2W §1, §2).
 *
 * ## What changed, and why
 *
 * This route was a thirteen-step founder round: select, extend, audition,
 * loop, pause, copy, paste, duplicate, move, repeat, delete, undo, redo. It
 * was built carefully, corrected twice, and it produced both a false positive
 * (eight steps passing with nothing done) and — on the run after that was
 * fixed — a false negative: a "Taşı" that really worked, which the harness
 * failed to see, stopping the founder at step 8.
 *
 * Both failures share a cause that no further repair removes. Copy, move,
 * delete, undo and redo are claims about bytes, and a person performing them
 * by hand on a phone is a slow, error-prone way to check something a test can
 * check exactly. So the division is now fixed: **Claude and CI own everything
 * mechanical, and the founder owns only what an ear can judge** — which is
 * `/eval/listening-pack`.
 *
 * ## What this route is still for
 *
 * Diagnosis, by whoever is working on the editor. Its step contracts, typed
 * evidence states, transaction ledger, isolation record and negative controls
 * are all still correct and still tested, and its automated positive and
 * negative browser controls stay green. None of that was weakened when it
 * stopped being a gate.
 *
 * What it must not do is come back as a release requirement. Completing it by
 * hand proves nothing that `npm test` does not prove faster.
 *
 * ## Known, non-blocking
 *
 * Step 8 (`move`) can refuse a move the editor really performed. The
 * production move is not in doubt — `move_onset_group` and its transaction
 * are covered by unit tests and by the automated browser control that walks
 * all thirteen steps — so this is a defect of the diagnostic's own evidence
 * matching, recorded here rather than repaired in a batch about shipping.
 */
export const metadata: Metadata = {
  title: `${BRAND_NAME} · Editör tanılama (geliştirici)`,
  robots: { index: false, follow: false },
};

export default function EditorActionBatchPage() {
  return <EditorActionBatch />;
}
