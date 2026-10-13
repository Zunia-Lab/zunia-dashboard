import { llmsTxt } from "@/lib/llms";

/**
 * GET /llms.txt: the app described for assistants (src/lib/llms.ts), as
 * plain text. robots.txt leaves it crawlable (it only keeps out /dev/), and
 * the sitemap leaves it out: it is not a page. Built from the modules the
 * app runs on, so a deploy that changes a fact changes this file with it.
 */
export function GET() {
  return new Response(llmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
