import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Launch Weather Replay",
  description: "Prepare archived Level II radar and time-windowed KSC placefiles for GR2Analyst.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
