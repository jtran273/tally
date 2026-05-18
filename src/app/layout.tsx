import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tally - Personal Finance Copilot",
  description: "A calm personal finance dashboard for reviewing bank data, recurring spending, and trusted budget records.",
  applicationName: "Tally",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tally"
  },
  icons: {
    apple: "/icons/tally-icon-192.png",
    icon: "/icons/tally-icon-192.png"
  }
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#f7f7f4",
  viewportFit: "cover",
  width: "device-width"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
