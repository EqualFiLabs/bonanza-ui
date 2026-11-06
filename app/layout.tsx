import type { Metadata, Viewport } from "next";
import { Big_Shoulders, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { BeaconStrip } from "@/components/shell/BeaconStrip";
import { ForkTools } from "@/components/shell/ForkTools";
import { Masthead } from "@/components/shell/Masthead";
import { Notices } from "@/components/shell/Notices";
import { ThemeButton } from "@/components/shell/ThemeButton";
import { AppProviders } from "@/providers/AppProviders";

import "./globals.css";

const display = Big_Shoulders({
  subsets: ["latin"],
  weight: ["600", "800", "900"],
  display: "swap",
  variable: "--font-display",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
});

// A nonce-based content security policy needs each response rendered per request.
export const dynamic = "force-dynamic";

const description =
  "Provably drawn onchain rounds on Robinhood Chain. Every ticket is a pixel of static until the drand beacon lands.";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: { default: "Bonanza", template: "%s · Bonanza" },
  description,
  icons: { icon: "/icon.svg" },
  openGraph: { title: "Bonanza", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Bonanza", description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <AppProviders>
          <Masthead />
          <BeaconStrip />
          <Notices />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <footer>
            <span>Bonanza runs on Robinhood Chain and draws from drand Quicknet.</span>
            <span>USD prices aren&apos;t available yet.</span>
            <ThemeButton />
          </footer>
          <ForkTools />
        </AppProviders>
      </body>
    </html>
  );
}
