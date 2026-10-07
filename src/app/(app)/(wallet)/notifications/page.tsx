import type { Metadata } from "next";
import { NotificationsPage } from "./NotificationsPage";

const DESCRIPTION =
  "Your Zunia notification center: incoming transfers, IBC arrivals, rewards ready to claim, votes ending and validator alerts by day, with browser alerts, push and quiet hours.";

export const metadata: Metadata = {
  title: "Notifications",
  description: DESCRIPTION,
  alternates: { canonical: "/notifications" },
  openGraph: { title: "Notifications · Zunia", description: DESCRIPTION, url: "/notifications" },
  // Personal page: what it shows depends on the connected wallet.
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default function NotificationsRoute() {
  return <NotificationsPage />;
}
