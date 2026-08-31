import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zunia Wallet",
  description: "Portfolio and activity for your Zunia wallet.",
  metadataBase: new URL("https://wallet.zuniawallet.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
