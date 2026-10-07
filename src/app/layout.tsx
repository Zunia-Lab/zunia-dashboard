import type { Metadata, Viewport } from "next";
import { ClientProviders } from "@/components/ClientProviders";
import { THEME_BOOT_SCRIPT, THEME_COLORS } from "@/components/shell/theme-boot";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const TITLE = "Zunia — Cosmos portfolio, staking & swap dashboard";
const DESCRIPTION =
  "Every Cosmos chain in one decision desk: balances, staking, governance, swaps and IBC across your networks, analysed and compared. Non-custodial: your keys stay in your wallet.";

/**
 * Site-wide defaults. Pages set their own title (through the template),
 * description, canonical URL and Open Graph; public pages opt in to indexing
 * with `robots: { index: true }`. The default keeps wallet pages out of
 * search while letting crawlers follow links to the public ones.
 *
 * No manifest link here: `app/manifest.ts` is served and linked by Next.
 * The Open Graph and Twitter images come from `app/opengraph-image.tsx` and
 * `app/twitter-image.tsx`. `metadataBase` is the public origin
 * (`@/lib/site`, app.zunialab.com), so every relative canonical, `og:url` and
 * image URL a page sets comes out absolute on it, whichever host served the
 * request.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Zunia",
  },
  description: DESCRIPTION,
  applicationName: "Zunia",
  category: "finance",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zunia",
  },
  // Addresses and amounts are not phone numbers: iOS must not linkify them.
  formatDetection: { telephone: false, address: false, email: false },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon", type: "image/png", sizes: "32x32" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Zunia",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@ZuniaLab",
    creator: "@ZuniaLab",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
};

export const viewport: Viewport = {
  // The boot script repaints these with the theme actually shown (dark by
  // default, whatever the OS prefers); these values only cover a disabled
  // script.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  width: "device-width",
  initialScale: 1,
  // The frame pads itself with env(safe-area-inset-*); without cover those
  // insets are always 0 and an installed iOS app draws under the notch.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The document scrolls (no viewport-height lock): sticky bars, scroll
    // restoration and full-page captures work as on any web page.
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        {/* Theme and sidebar width before the first paint (see theme-boot.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="zunia-root min-h-dvh">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
