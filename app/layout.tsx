import type { Metadata } from "next";
// eslint-disable-next-line module-boundaries/no-cross-module-import
import "./globals.css";

export const metadata: Metadata = {
  title: "Pavement Operations OS · Docket Recon",
  description: "Operational and commercial control for asphalt, road surfacing and civil contractors.",
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
