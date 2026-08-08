import type { Metadata, Viewport } from "next";
import NetworkStatus from "@/components/NetworkStatus";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ファスティング倶楽部",
    template: "%s | ファスティング倶楽部",
  },
  applicationName: "ファスティング倶楽部",
  description: "ファスティングと体重記録をやさしく続けるためのアプリ",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ファスティング倶楽部",
  },
  formatDetection: {
    telephone: false,
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#5f9f9b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-[#f5f1eb] text-slate-950">
        <NetworkStatus />
        {children}
      </body>
    </html>
  );
}
