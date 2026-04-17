/**
 * @file Root layout for the Pocket CEP app.
 *
 * Sets up the HTML shell with Inter font (close to Google Sans),
 * metadata, and the base document structure. This layout wraps every
 * page in the app.
 *
 * Next.js App Router requires exactly one root layout. Child pages
 * and nested layouts are injected via the `children` prop. There is
 * no client-side provider wrapper here because BetterAuth manages
 * sessions via HTTP-only cookies, avoiding the need for a React
 * context at the root.
 */

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * Inter is used as the closest freely-available approximation of Google
 * Sans. The CSS variable `--font-inter` lets Tailwind reference it via
 * the `font-inter` utility, keeping font configuration in one place.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pocket CEP",
  description:
    "Educational companion for the Chrome Enterprise Premium MCP server. " +
    "Investigate user activity and chat with an AI-powered admin assistant.",
};

/**
 * Root layout shell shared by every page. Uses `min-h-dvh` (dynamic
 * viewport height) so mobile browsers with collapsing address bars
 * still fill the screen correctly.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="flex min-h-dvh flex-col antialiased">{children}</body>
    </html>
  );
}
