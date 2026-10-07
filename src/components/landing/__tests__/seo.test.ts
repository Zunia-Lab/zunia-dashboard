/**
 * Metadata of the public pages this area owns (src/components/landing/seo.ts):
 * indexable, canonical, and never without the share image (a page that sets
 * its own openGraph / twitter replaces the root's, file image included).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SHARE_IMAGE_ALT, publicPageMetadata } from "../seo";

describe("publicPageMetadata", () => {
  const metadata = publicPageMetadata({ title: "Apps (coming soon)", description: "A directory.", path: "/apps" });

  test("indexable and canonical at its own path", () => {
    assert.deepEqual(metadata.robots, { index: true, follow: true, googleBot: { index: true, follow: true } });
    assert.deepEqual(metadata.alternates, { canonical: "/apps" });
    assert.equal(metadata.title, "Apps (coming soon)");
  });

  test("link previews carry the share image and the brand", () => {
    const og = metadata.openGraph as { images: Array<{ url: string; alt: string; width: number; height: number }>; title: string; url: string };
    const twitter = metadata.twitter as { images: Array<{ url: string; alt: string }>; title: string; card: string };
    assert.deepEqual(
      og.images.map((image) => [image.url, image.width, image.height, image.alt]),
      [["/opengraph-image", 1200, 630, SHARE_IMAGE_ALT]],
    );
    assert.deepEqual(twitter.images.map((image) => image.url), ["/twitter-image"]);
    assert.equal(twitter.card, "summary_large_image");
    assert.equal(og.title, "Apps (coming soon) · Zunia");
    assert.equal(og.url, "/apps");
  });
});
