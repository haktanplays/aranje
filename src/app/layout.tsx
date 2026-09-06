import type { Metadata, Viewport } from "next";

import { BUILD_SHA } from "@/lib/acceptance/build-id";
import { Fraunces, Inter } from "next/font/google";

import { BRAND_NAME } from "@/lib/brand";

import "./globals.css";

/* Fonts are self-hosted through next/font (spec 13.6). latin-ext carries the
   Turkish letters. */
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-fraunces",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: `${BRAND_NAME} pilot`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101114",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" className={`${fraunces.variable} ${inter.variable}`}>
      {/*
        Which commit this build was made from (2V-D.2 c3 §16).

        The geometry runner reads it off the page rather than being told it,
        so a stale build cannot pass by being pointed at with the right
        argument on the command line. Absent in a dev server, which is
        correct: there is no commit behind a dev server, and `BUILD_SHA`
        says "unknown" rather than pretending.

        Read through `BUILD_SHA`, which the acceptance route already refuses
        to run on the wrong value of — one build identity, not a second one
        beside it, and one place that reads the environment.
      */}
      <body
        className="min-h-dvh bg-app text-text antialiased"
        data-build-sha={BUILD_SHA}
      >
        {children}
      </body>
    </html>
  );
}
