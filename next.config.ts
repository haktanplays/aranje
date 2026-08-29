import { execSync } from "node:child_process";

import type { NextConfig } from "next";

/**
 * Which commit this bundle was built from (2U-A handoff §4).
 *
 * The founder acceptance route has to be able to refuse an old deploy, and it
 * cannot do that from anything written by hand: a constant in a component is
 * a claim about the build, made by a person, that stays true-looking after it
 * stops being true. So the answer is taken at build time, from the build.
 *
 * Vercel's own variable first, because on Vercel there is no git checkout to
 * ask; the local git otherwise; and `unknown` if neither can answer, which the
 * route treats as "cannot verify" rather than as a pass.
 */
function buildSha(): string {
  const fromHost = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromHost && fromHost.length >= 7) return fromHost;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    /*
     * Public on purpose, and the opposite of a secret: it exists so a reader
     * can prove which build is in front of them.
     */
    NEXT_PUBLIC_ARANJE_BUILD_SHA: buildSha(),
  },
};

export default nextConfig;
