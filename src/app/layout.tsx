import type { Metadata, Viewport } from "next";
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
      <body className="min-h-dvh bg-app text-text antialiased">{children}</body>
    </html>
  );
}
