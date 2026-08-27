import type { Metadata } from "next";

import { AcceptanceConductor } from "@/components/acceptance/AcceptanceConductor";

/**
 * The guided Android acceptance run (K-59.1 §3).
 *
 * Not linked from anywhere in the product, and told not to be indexed. It is
 * reached by one URL, on a phone, for about five minutes — no sign-in, no
 * permission prompt, no provider call, and a fixed riff in a storage the page
 * owns rather than the reader's own music.
 */
export const metadata: Metadata = {
  title: "Aranjé · Android kabul testi",
  robots: { index: false, follow: false },
};

export default function AndroidAcceptancePage() {
  return <AcceptanceConductor />;
}
