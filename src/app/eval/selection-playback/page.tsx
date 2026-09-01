import type { Metadata } from "next";

import { BRAND_NAME } from "@/lib/brand";

import { SelectionPlaybackAcceptance } from "@/components/acceptance/SelectionPlaybackAcceptance";

/**
 * The guided founder listening test (2V-A.1 §7, §8).
 *
 * Its own route, and deliberately not `/eval/editor-acceptance`. That one is
 * the general editor test — thirty-six phases over selection, clipboard,
 * undo, movement and rhythm — and handing its result back as a listening
 * result is how a round gets accepted without anyone having heard anything.
 *
 * Not linked from anywhere, told not to be indexed, and reached by one URL
 * carrying the commit it expects. The workspace underneath is the real one,
 * with the real drawer and the real audio engine, on a two-track fixture in a
 * storage the page owns: no sign-in, no provider call, and not one byte of
 * the reader's own music touched.
 *
 * Nothing plays until the reader presses something. There is no test-only
 * playback control anywhere on this page.
 */
export const metadata: Metadata = {
  title: `${BRAND_NAME} · Seçimi dinle kabulü`,
  robots: { index: false, follow: false },
};

export default function SelectionPlaybackAcceptancePage() {
  return <SelectionPlaybackAcceptance />;
}
