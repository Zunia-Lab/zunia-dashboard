import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UiKitDemo } from "./UiKitDemo";

/**
 * /dev/kit/ui: every UI kit component in both themes, for building and
 * reviewing pages. Development only: production builds answer 404, so this
 * page and its sample data never reach users.
 *
 * The guard lives in this server component (notFound() is documented for
 * server components) and the catalogue itself is a client component.
 */

export const metadata: Metadata = {
  title: "UI kit",
  robots: { index: false, follow: false },
};

export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiKitDemo />;
}
