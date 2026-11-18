/**
 * The one checker for custom CSS at all three levels (the whole site, one page,
 * one block). It refuses what the site code check refuses in a stylesheet, and
 * more: a CSS box has no reason to fetch from another site at all. Each
 * refusal names the line it is on.
 *
 * Every rule is run at each level. A block's CSS must also start each rule from
 * `selector`, so the same CSS is written there inside a `selector` rule.
 */
import { describe, expect, it } from "vitest";

import {
  checkCustomCss,
  CUSTOM_CSS_CHECKER_ID,
  customCssPolicy,
  customCssProblemText,
} from "./css-check";
import { SITE_CODE_LIMITS } from "./limits";

type Level = "site" | "page" | "block";
const LEVELS: readonly Level[] = ["site", "page", "block"];

/** CSS as written at a level: inside a `selector` rule for a block. */
const at = (level: Level, declarations: string, before = ""): string =>
  level === "block"
    ? `${before}selector { ${declarations} }`
    : `${before}.thing { ${declarations} }`;

describe.each(LEVELS)("custom CSS at the %s level", level => {
  const reasons = (css: string) =>
    checkCustomCss(css, level).map(problem => problem.reason);

  it("accepts plain CSS, and a picture from this site", () => {
    expect(
      checkCustomCss(
        at(level, "color: teal; background: url(/img/a.png) no-repeat;"),
        level
      )
    ).toEqual([]);
  });

  it("refuses @import, naming its line", () => {
    expect(
      checkCustomCss(`${at(level, "color: red;")}\n@import url(/a.css);`, level)
    ).toEqual([{ line: 2, reason: "@import isn't allowed." }]);
  });

  it.each([
    ["another site, as https", "url(https://fonts.example/x.woff2)"],
    ["another site, with no scheme", "url(//tracker.example/p)"],
    ["an http address", "url(http://example.com/a.png)"],
    ["a script address", 'url("javascript:alert(1)")'],
    ["a data address", 'url("data:image/svg+xml,<svg/>")'],
    ["an image-set string", 'image-set("https://tracker.example/p" 1x)'],
  ])("refuses a fetch from %s", (_case, url) => {
    const problems = checkCustomCss(at(level, `background: ${url};`), level);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toMatch(
      /^Only pictures and fonts from this site can be used:/
    );
  });

  it("refuses a fetch kept in a custom property, naming its line", () => {
    // css-tree keeps a custom property's value as text, which a fetch check
    // reading only parsed `url()` nodes would pass.
    const css = at(
      level,
      "--picture: url(https://tracker.example/p); background: var(--picture);",
      "/* first */\n"
    );
    const problems = checkCustomCss(css, level);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
    expect(problems[0]?.reason).toMatch(/tracker\.example/);
  });

  it("refuses CSS that would end the style element, naming its line", () => {
    expect(
      checkCustomCss(
        `${at(level, "color: red;")}\n/* </style><script>x()</script> */`,
        level
      )
    ).toEqual([
      {
        line: 2,
        reason: "</style isn't allowed: it would end the styles early.",
      },
    ]);
  });

  it.each([
    ["expression()", "width: expression(alert(1));"],
    ["behavior", "behavior: url(/x.htc);"],
    ["-moz-binding", "-moz-binding: url(/x.xml#y);"],
  ])("refuses %s, which can run script", (name, declaration) => {
    expect(reasons(at(level, declaration))).toContain(
      `${name} isn't allowed: it can run script.`
    );
  });

  it("refuses a pasted <style> wrapper, with what to do", () => {
    expect(reasons(`<style>${at(level, "color: red;")}</style>`)).toContain(
      "Paste the CSS without the <style> tags."
    );
  });

  it("refuses CSS longer than a box may hold", () => {
    const long = at(
      level,
      `color: red; ${"/* x */".repeat(SITE_CODE_LIMITS.slotChars)}`
    );
    expect(reasons(long)).toEqual([
      `This CSS is longer than ${SITE_CODE_LIMITS.slotChars} characters.`,
    ]);
  });
});

describe("custom CSS at the block level", () => {
  it("also refuses a rule that does not start from selector, naming its line", () => {
    expect(
      checkCustomCss("selector { color: red; }\nh2 { color: blue; }", "block")
    ).toEqual([
      { line: 2, reason: "A rule in a block's CSS starts with selector." },
    ]);
  });

  it("is not held to selector at the site and page levels", () => {
    expect(checkCustomCss("h2 { color: blue; }", "page")).toEqual([]);
    expect(checkCustomCss("body { margin: 0; }", "site")).toEqual([]);
  });
});

describe("customCssProblemText", () => {
  it("reads as the boxes show it", () => {
    expect(
      customCssProblemText({ line: 3, reason: "@import isn't allowed." })
    ).toBe("Line 3: @import isn't allowed.");
  });
});

describe("customCssPolicy", () => {
  it("accepts what the checker accepts, at each level", () => {
    const policy = customCssPolicy("body { margin: 0; }");
    expect(policy.id).toBe(CUSTOM_CSS_CHECKER_ID);
    expect(policy.site).toBe("body { margin: 0; }");
    expect(policy.accepts("selector { color: red; }", "block")).toBe(true);
    expect(policy.accepts("@import url(/a.css);", "page")).toBe(false);
    expect(policy.accepts("h2 { color: red; }", "block")).toBe(false);
  });

  it("carries no site CSS when the site has none", () => {
    expect(customCssPolicy(undefined)).not.toHaveProperty("site");
  });
});
