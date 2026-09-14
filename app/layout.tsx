import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

/**
 * Barlow is drawn from American public-signage vernacular, which is the right
 * voice for a game played at speed: the condensed width carries the display
 * type the way a road sign does.
 */
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Song Chain",
  description: "A car-trip word game played through Spotify.",
};

export const viewport: Viewport = {
  themeColor: "#10202b",
  // The interface is built for a phone held in one hand; zooming it would
  // only hide the thing that matters.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
