import type { Metadata, Viewport } from "next";
import { ClientProviders } from "@/components/ClientProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Zunia Wallet",
    template: "%s · Zunia",
  },
  description:
    "Portfolio and activity for your Zunia wallet. Keys stay in the extension or on your phone.",
  metadataBase: new URL("https://wallet.zuniawallet.com"),
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zunia",
  },
  applicationName: "Zunia",
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
