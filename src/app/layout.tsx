/**
 * @file Root layout for the Pocket CEP app.
 *
 * Uses Roboto as a freely-available stand-in for Google Sans Text —
 * the typeface Google Workspace admin consoles actually ship with —
 * and Roboto Mono for identifiers and raw data. CSS variables expose
 * them so utilities and prose styles can reference them.
 */

import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const robotoMono = Roboto_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pocket CEP",
  description:
    "Educational companion for the Chrome Enterprise Premium MCP server. " +
    "Investigate user activity and chat with an AI-powered admin assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable} h-full`}>
      <body className="flex min-h-dvh flex-col antialiased">{children}</body>
    </html>
  );
}
