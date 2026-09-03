import type { Metadata } from "next";

import { BRAND_NAME } from "@/lib/brand";

import { ListeningPackPage } from "@/components/listening/ListeningPackPage";

/**
 * The founder's listening round (2W §3).
 *
 * This route replaces the editor acceptance ritual as the release gate. The
 * division is deliberate and final for this phase: bytes, gestures, undo,
 * isolation and geometry are checked by tests, and the founder is asked only
 * about the things a test cannot honestly hear.
 *
 * Not indexed and not linked from the app. It touches no project of the
 * reader's: the music is a fixture built in memory, and nothing on this page
 * writes to storage at all.
 */
export const metadata: Metadata = {
  title: `${BRAND_NAME} · Kulak testi`,
  robots: { index: false, follow: false },
};

export default function ListeningPackRoute() {
  return <ListeningPackPage />;
}
