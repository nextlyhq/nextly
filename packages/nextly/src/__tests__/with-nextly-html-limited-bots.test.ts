/**
 * The crawlers a Nextly site answers with each page's whole head in the first
 * HTML (`htmlLimitedBots`): Next.js's own list, held here to the installed
 * Next.js so a crawler it adds is never dropped, plus the main Googlebot and
 * the AI crawlers. `withNextly()` sets it unless the app set its own; a
 * browser is still streamed to.
 */
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { nextlyHtmlLimitedBots, withNextly } from "../next";

/** Next.js's own default list, as the installed Next.js spells it. */
const nextDefault = (
  createRequire(createRequire(import.meta.url).resolve("next/package.json"))(
    "next/dist/shared/lib/router/utils/html-bots"
  ) as {
    HTML_LIMITED_BOT_UA_RE: RegExp;
  }
).HTML_LIMITED_BOT_UA_RE;

/** Clears the Cache Components warning these configs queue, unsent. */
afterEach(() => {
  const holder = globalThis as Record<symbol, { timer?: unknown } | undefined>;
  for (const key of [
    Symbol.for("nextly/cache-components-queued-warnings"),
    Symbol.for("nextly/cache-components-off-warned"),
  ]) {
    const held = holder[key];
    if (held && typeof held === "object" && "timer" in held) {
      clearTimeout(held.timer as ReturnType<typeof setTimeout>);
    }
    delete holder[key];
  }
});

describe("nextlyHtmlLimitedBots", () => {
  it("keeps every crawler in the installed Next.js's own list", () => {
    // Setting htmlLimitedBots replaces Next.js's default, so ours must carry
    // all of it: its source starts with the default's, alternative for
    // alternative.
    expect(
      nextlyHtmlLimitedBots.source.startsWith(`${nextDefault.source}|`)
    ).toBe(true);
    expect(nextlyHtmlLimitedBots.flags).toContain("i");
  });

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  ])("waits for %s", userAgent => {
    expect(nextlyHtmlLimitedBots.test(userAgent)).toBe(true);
  });

  it("still streams to a browser", () => {
    expect(
      nextlyHtmlLimitedBots.test(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
      )
    ).toBe(false);
  });
});

/** `withNextly()` on a config typed as Next.js reads it: any key, any value. */
const wrap = (config: Record<string, unknown>) => withNextly(config);

describe("withNextly's htmlLimitedBots", () => {
  it("sets Nextly's list where the app set none", () => {
    expect(wrap({}).htmlLimitedBots).toBe(nextlyHtmlLimitedBots);
  });

  it("keeps the app's own list where it set one", () => {
    const own = /OnlyThisBot/i;
    expect(wrap({ htmlLimitedBots: own }).htmlLimitedBots).toBe(own);
  });
});
