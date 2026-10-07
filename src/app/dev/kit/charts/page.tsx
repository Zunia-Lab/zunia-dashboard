import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/styles/viz.css";
import { ChartsKitDemo } from "./ChartsKitDemo";

export const metadata: Metadata = {
  title: "Chart kit",
  robots: { index: false, follow: false },
};

/**
 * Development page for the chart kit: every chart, every state, on synthetic
 * data. It must never ship: production builds answer 404 here.
 *
 * The page itself is a Server Component only so `notFound()` runs where
 * Next.js supports it; everything visible is the client demo below.
 */
export default function ChartKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ChartsKitDemo />;
}
