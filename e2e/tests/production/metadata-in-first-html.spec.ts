import { expect } from "@playwright/test";

import { test } from "../support/visible";

/**
 * Search engines and AI crawlers read a page's whole head in the first HTML
 * they are sent, on the build a visitor gets.
 *
 * Next.js streams a page's metadata in after the head to a browser, and waits
 * only for the crawlers in `htmlLimitedBots`. A Nextly site's config sets it to
 * `nextlyHtmlLimitedBots`: Next.js's own list, the main Googlebot and the AI
 * crawlers. So as each of them, the page's title is inside `<head>` in the
 * response's first 2 MB, exactly as a browser ends up showing it, and a page
 * that does not exist answers a true 404 rather than a 200 with a not-found
 * body.
 *
 * The home page is a Page Builder Single, so this also reads a Page Builder
 * route's head.
 *
 * @module tests/production/metadata-in-first-html
 */

/** The crawlers read here: a search engine, two AI crawlers, a social card. */
const CRAWLERS = {
  Googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  GPTBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  ClaudeBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  facebookexternalhit:
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
};

/** How much of a response a crawler is held to reading. */
const FIRST_HTML_BYTES = 2 * 1024 * 1024;

/** The `<head>` of the first 2 MB of some HTML, or "" when it has none. */
function firstHead(html: string): string {
  const start = html.slice(0, FIRST_HTML_BYTES);
  return /<head[^>]*>([\s\S]*?)<\/head>/i.exec(start)?.[1] ?? "";
}

/** Text as an HTML document spells it inside an element. */
const asHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

test.describe("metadata in the first HTML, on a production build", () => {
  for (const [name, userAgent] of Object.entries(CRAWLERS)) {
    test(`${name} reads the home page's title in the head it is sent`, async ({
      page,
      request,
    }) => {
      // The title a browser ends up with, metadata streamed in or not.
      await page.goto("/");
      const title = await page.title();
      expect(title, "the home page has a title to read").not.toBe("");

      const response = await request.get("/", {
        headers: { "user-agent": userAgent },
      });
      expect(response.status()).toBe(200);
      expect(firstHead(await response.text())).toContain(
        `<title>${asHtml(title)}</title>`
      );
    });
  }

  test("a page that does not exist answers Googlebot a true 404", async ({
    request,
  }) => {
    const response = await request.get("/no-such-page-anywhere", {
      headers: { "user-agent": CRAWLERS.Googlebot },
    });
    expect(response.status()).toBe(404);
  });
});
