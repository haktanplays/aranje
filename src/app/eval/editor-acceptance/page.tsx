import type { Metadata } from "next";

import { BRAND_NAME } from "@/lib/brand";

import { EditorAcceptance } from "@/components/acceptance/EditorAcceptance";

/**
 * The guided founder editor acceptance run (2U-A handoff §2, §3).
 *
 * Not linked from anywhere in the product, and told not to be indexed. It is
 * reached by one URL carrying the commit it expects — a link opened against
 * any other build refuses to start rather than accepting a stale deploy.
 *
 * The workspace underneath is the real one, on a two-track fixture, in a
 * storage the page owns: no sign-in, no permission prompt, no provider call,
 * and not one byte of the reader's own music touched.
 */
export const metadata: Metadata = {
  title: `${BRAND_NAME} · Editör kabul testi`,
  robots: { index: false, follow: false },
};

export default function EditorAcceptancePage() {
  return <EditorAcceptance />;
}
