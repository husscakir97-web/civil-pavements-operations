import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Infrastruct",
  description: "The operating system for civil and infrastructure contractors: win, prepare, resource, deliver, control money and learn.",
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
