/**
 * @file Root layout for the Pocket CEP app.
 *
 * Sets up the HTML shell with Inter font (close to Google Sans),
 * metadata, and the base document structure. This layout wraps every
 * page in the app.
 */

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
