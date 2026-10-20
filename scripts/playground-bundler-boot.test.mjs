/**
 * What the playground boot check reads from a page and from the server's
 * log. The boot itself is run by the CI job; these cases pin the reading.
 */
import { describe, expect, it } from "vitest";

import { firstError, linkedAssets } from "./playground-bundler-boot.mjs";

describe("the assets a page links", () => {
  it("lists stylesheets and scripts, and decodes their ampersands", () => {
    const html = [
      '<link rel="stylesheet" href="/_next/static/css/app.css?v=1&amp;x=2" data-precedence="next"/>',
      '<link rel="preload" href="/_next/static/media/font.woff2" as="font"/>',
      '<script src="/_next/static/chunks/main.js" async=""></script>',
      "<script>self.__next_f=[]</script>",
    ].join("");
    expect(linkedAssets(html)).toEqual([
      "/_next/static/css/app.css?v=1&x=2",
      "/_next/static/chunks/main.js",
    ]);
  });
});

describe("the first error in the server log", () => {
  it("gives a compile error's place with what went wrong on the line after it", () => {
    const log = [
      "  ▲ Next.js 16.2.11 (webpack)",
      " ✓ Ready in 2.1s",
      "⨯ ../../node_modules/drizzle-kit/payload-mysql.js:131478:29",
      "Module not found: Can't resolve '@electric-sql/pglite'",
      "  131476 | 			if (driver === \"pglite\") {",
    ].join("\n");
    expect(firstError(log)).toBe(
      "⨯ ../../node_modules/drizzle-kit/payload-mysql.js:131478:29 Module not found: Can't resolve '@electric-sql/pglite'"
    );
  });

  it("gives the error line alone when it is the log's last", () => {
    expect(firstError(" ✓ Ready in 2.1s\nError: listen EADDRINUSE")).toBe(
      "Error: listen EADDRINUSE"
    );
  });

  it("gives nothing for a log without an error", () => {
    expect(firstError(" ✓ Ready in 2.1s\n ○ Compiling /admin ...")).toBe(
      undefined
    );
  });
});
