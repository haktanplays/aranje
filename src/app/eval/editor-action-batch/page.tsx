import type { Metadata } from "next";

import { BRAND_NAME } from "@/lib/brand";

import { EditorActionBatch } from "@/components/acceptance/EditorActionBatch";

/**
 * The one batched founder round (2V-B §9).
 *
 * Three rounds in a row ended by sending a founder a new link for one
 * control — the clipboard link, the "Devam" link, the listening link — and
 * each was answered honestly and found the next defect somewhere the link did
 * not go. This route is every selection action in one pass, so the answer that
 * comes back is about the editor rather than about a button.
 *
 * Not linked from anywhere, told not to be indexed, and reached by one URL
 * carrying the commit it expects. The workspace underneath is the real one,
 * with the real selection surfaces and the real audio engine, on a two-track
 * fixture in a storage the page owns: no sign-in, no provider call, and not
 * one byte of the reader's own music touched.
 *
 * Nothing plays and nothing is written until the reader presses a production
 * control. There is no test-only control anywhere on this page that does what
 * a production control does.
 */
export const metadata: Metadata = {
  title: `${BRAND_NAME} · Editör eylem kabulü`,
  robots: { index: false, follow: false },
};

export default function EditorActionBatchPage() {
  return <EditorActionBatch />;
}
