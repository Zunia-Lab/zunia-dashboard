import type { Metadata, Viewport } from "next";
import { ClientProviders } from "@/components/ClientProviders";
import "./globals.css";

const SITE_URL = "https://wallet.zunialab.com";
const DESCRIPTION =
  "Portfolio and activity for your Zunia wallet. Keys stay in the extension or on your phone.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Zunia Wallet",
    template: "%s · Zunia",
  },
  description: DESCRIPTION,
  applicationName: "Zunia",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zunia",
  },
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
    url: SITE_URL,
    title: "Zunia Wallet",
    description: DESCRIPTION,
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: "Zunia Wallet",
    description: DESCRIPTION,
  },
  // Gated product shell: allow preview fetchers, keep pages out of search.
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1F0EE" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0A09" },
  ],
  width: "device-width",
  initialScale: 1,
};

/** Apply stored / system theme before paint to avoid a dark flash. */
const THEME_BOOT = `(function(){try{var k="zunia-theme";var t=localStorage.getItem(k);var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var r=t==="light"||t==="dark"?t:d?"dark":"light";var el=document.documentElement;el.setAttribute("data-theme",r);el.classList.toggle("zunia-dark",r==="dark");el.classList.toggle("zunia-light",r==="light");el.style.colorScheme=r;}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-dvh overflow-hidden antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="zunia-root flex h-dvh min-h-0 flex-col overflow-hidden">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
