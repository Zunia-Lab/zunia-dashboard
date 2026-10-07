import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/SettingsPage";
import packageJson from "../../../../../package.json";

const DESCRIPTION =
  "Zunia dashboard settings: currency, theme and privacy, followed networks, the connected wallet and phone, notifications, and the data kept on this browser.";

export const metadata: Metadata = {
  title: "Settings",
  description: DESCRIPTION,
  alternates: { canonical: "/settings" },
  openGraph: { title: "Settings · Zunia", description: DESCRIPTION, url: "/settings" },
  // Renders without a wallet, but it is a personal preferences page: no search result.
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

/** The version is read here, on the server: only the string reaches the browser. */
export default function SettingsRoute() {
  return <SettingsPage version={packageJson.version} />;
}
