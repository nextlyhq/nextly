/**
 * A site's own robots.txt lines, read line by line as the screen and the
 * stored value's rule both read them: a rule that keeps every crawler,
 * Googlebot or Bingbot away from the home page or the whole site is refused;
 * a near miss is not; a misspelt rule is warned about; a line that is not a
 * standard rule is kept with a note; a group naming an AI crawler is said to
 * replace the AI choice for it, and one naming a search crawler to replace
 * the rules for every crawler. Which pages a rule blocks is decided as
 * crawlers decide it: the most specific group, then the longest rule.
 */
import { describe, expect, it } from "vitest";

import { blockingRule, groupsOf, readOwnRules } from "../robots-rules";

const refusals = (text: string) =>
  readOwnRules(text).findings.filter(finding => finding.level === "refused");

describe("readOwnRules: what is refused", () => {
  it.each([
    ["User-agent: *\nDisallow: /", 2, "every crawler", "the whole site"],
    ["User-agent: *\nDisallow: /*", 2, "every crawler", "the whole site"],
    ["User-agent: *\nDisallow: /*$", 2, "every crawler", "the whole site"],
    ["User-agent: Googlebot\nDisallow: /", 2, "Googlebot", "the whole site"],
    ["user-agent: BINGBOT\ndisallow: /", 2, "Bingbot", "the whole site"],
    ["User-agent: *\nDisallow: /$", 2, "every crawler", "the home page"],
    [
      "User-agent: *\nAllow: /$\nDisallow: /",
      3,
      "every crawler",
      "the whole site",
    ],
    [
      "User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /",
      3,
      "Googlebot",
      "the whole site",
    ],
  ])("refuses %j", (text, line, who, what) => {
    expect(refusals(text)).toEqual([
      {
        line,
        level: "refused",
        message: `Line ${line} would keep ${who} away from ${what}, so it can't be saved. robots.txt doesn't keep pages out of Google's index anyway. To keep pages out of search, use Hide from search on a page or a content type.`,
      },
    ]);
  });

  it.each([
    "User-agent: *\nDisallow: /search",
    "User-agent: *\nDisallow: /*?filter=",
    "User-agent: *\nDisallow:",
    "User-agent: GPTBot\nDisallow: /",
    "User-agent: Googlebot-Image\nDisallow: /",
    "User-agent: *\nDisallow: /\nAllow: /",
    "User-agent: *\nDisallow: /a",
    "User-agent: *\nDisallow: /x",
  ])("accepts the near miss %j", text => {
    expect(refusals(text)).toEqual([]);
  });

  it("refuses a rule with no User-agent line above it", () => {
    expect(refusals("Disallow: /search")).toEqual([
      {
        line: 1,
        level: "refused",
        message:
          "Line 1 needs a User-agent line above it, saying which crawlers it is for.",
      },
    ]);
  });

  it("refuses a line holding a character robots.txt can't carry", () => {
    expect(refusals("User-agent: *\nDisallow: /a\u0000b")).toEqual([
      {
        line: 2,
        level: "refused",
        message: "Line 2 holds a character robots.txt can't carry.",
      },
    ]);
  });

  it("refuses more lines than the box keeps", () => {
    const text = ["User-agent: *", ...Array(300).fill("Disallow: /x")].join(
      "\n"
    );
    expect(refusals(text)[0]?.message).toBe(
      "Keep your own rules to 200 lines."
    );
  });
});

describe("readOwnRules: warnings and notes", () => {
  it("warns about a misspelt rule Google still reads, naming it", () => {
    expect(readOwnRules("User-agent: *\nDissalow: /tmp").findings).toEqual([
      {
        line: 2,
        level: "warning",
        message:
          'Line 2: "Dissalow" is misspelt. Google reads it as Disallow; other crawlers may skip it.',
      },
    ]);
  });

  it("warns about a line that is not a rule at all", () => {
    expect(
      readOwnRules("User-agent: *\nblock the search pages").findings
    ).toEqual([
      {
        line: 2,
        level: "warning",
        message:
          "Line 2 isn't a rule, so crawlers will skip it. A rule is a name, a colon and a value, such as Disallow: /search.",
      },
    ]);
  });

  it("warns about a path that does not start with /", () => {
    expect(readOwnRules("User-agent: *\nDisallow: search").findings).toEqual([
      {
        line: 2,
        level: "warning",
        message: "Line 2: a path starts with /, such as /search.",
      },
    ]);
  });

  it("keeps a line that is not a standard rule, with a note", () => {
    const read = readOwnRules(
      "User-agent: *\nDisallow: /search\nContent-Signal: search=yes, ai-train=no"
    );
    expect(read.findings).toEqual([
      {
        line: 3,
        level: "note",
        message:
          "Line 3 isn't a standard robots.txt rule. It's kept; crawlers may ignore it.",
      },
    ]);
    expect(read.refused).toBe(false);
  });

  it("explains a group that names an AI crawler as joined with the AI choice, without refusing it", () => {
    expect(readOwnRules("User-agent: GPTBot\nAllow: /docs/").findings).toEqual([
      {
        line: 1,
        level: "note",
        message:
          "Line 1 names GPTBot, so GPTBot follows this rule joined with what the AI tools choice above asks of it, and no longer the rules for every crawler: it may read /docs/. A page the choice keeps it from opens only with an Allow line.",
      },
    ]);
  });

  it("explains that a group naming a search crawler replaces the rules for every crawler", () => {
    expect(
      readOwnRules("User-agent: Googlebot\nDisallow: /search").findings
    ).toEqual([
      {
        line: 1,
        level: "note",
        message:
          "Line 1 names Googlebot, so Googlebot follows only the rules under it and skips those for every crawler, Nextly's own included.",
      },
    ]);
  });

  it("ignores blank lines and comments", () => {
    expect(
      readOwnRules(
        "# keep search out\n\nUser-agent: *\nDisallow: /search # results"
      ).findings
    ).toEqual([]);
  });
});

describe("blockingRule", () => {
  const groups = (text: string) => groupsOf(text);

  it("is the longest matching rule, an allow winning a tie", () => {
    const file = groups(
      "User-agent: *\nAllow: /\nDisallow: /blog\nAllow: /blog/open"
    );
    expect(blockingRule(file, "somebot", "/blog/a")?.line).toBe(3);
    expect(blockingRule(file, "somebot", "/blog/open/a")).toBeUndefined();
    expect(
      blockingRule(groups("User-agent: *\nAllow: /a\nDisallow: /a"), "x", "/a")
    ).toBeUndefined();
  });

  it("reads * and $ in a path as crawlers do", () => {
    const file = groups(
      "User-agent: *\nDisallow: /*?filter=\nDisallow: /*.pdf$"
    );
    expect(blockingRule(file, "x", "/shop?filter=red")?.line).toBe(2);
    expect(blockingRule(file, "x", "/files/a.pdf")?.line).toBe(3);
    expect(blockingRule(file, "x", "/files/a.pdf?x=1")).toBeUndefined();
  });

  it("follows the group naming the crawler, and every crawler's only where none does", () => {
    const file = groups(
      "User-agent: *\nDisallow: /search\n\nUser-agent: Googlebot\nDisallow: /private"
    );
    expect(blockingRule(file, "Googlebot", "/search")).toBeUndefined();
    expect(blockingRule(file, "googlebot", "/private")?.line).toBe(5);
    expect(blockingRule(file, "bingbot", "/search")?.line).toBe(2);
  });

  it("joins groups naming the same crawler", () => {
    const file = groups(
      "User-agent: GPTBot\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /docs/"
    );
    expect(blockingRule(file, "GPTBot", "/docs/a")).toBeUndefined();
    expect(blockingRule(file, "GPTBot", "/blog")?.line).toBe(2);
  });
});

describe("reading rules as crawlers do, at any size", () => {
  it("judges a rule of many wildcards at once, never by backtracking", () => {
    const text = `User-agent: *\nDisallow: /${"*".repeat(98)}z`;
    const started = performance.now();
    const read = readOwnRules(text);
    expect(performance.now() - started).toBeLessThan(200);
    expect(read.refused).toBe(false);
    const file = groupsOf(`User-agent: *\nDisallow: /${"*a".repeat(200)}z`);
    const again = performance.now();
    expect(blockingRule(file, "x", `/${"a".repeat(400)}`)).toBeUndefined();
    expect(performance.now() - again).toBeLessThan(200);
  });

  it("ends a run of User-agent lines at any rule, an empty one included", () => {
    const text =
      "User-agent: Googlebot\nDisallow:\nUser-agent: GPTBot\nDisallow: /";
    expect(refusals(text)).toEqual([]);
    expect(blockingRule(groupsOf(text), "googlebot", "/a")).toBeUndefined();
    expect(blockingRule(groupsOf(text), "gptbot", "/a")?.line).toBe(4);
  });

  it("compares paths and rules with their encodings made one", () => {
    const file = groupsOf("User-agent: *\nDisallow: /café\nDisallow: /%62log");
    expect(blockingRule(file, "x", "/caf%C3%A9/menu")?.line).toBe(2);
    expect(blockingRule(file, "x", "/caf%c3%a9")?.line).toBe(2);
    expect(blockingRule(file, "x", "/blog/a")?.line).toBe(3);
    // A reserved character keeps its meaning: %2F is not a path's slash.
    expect(
      blockingRule(groupsOf("User-agent: *\nDisallow: /a/b"), "x", "/a%2Fb")
    ).toBeUndefined();
  });
});

describe("round two of reading rules", () => {
  it("reads a rule holding a character beyond the basic plane", () => {
    const text = "User-agent: *\nDisallow: /\u{1F600}";
    expect(() => readOwnRules(text)).not.toThrow();
    expect(blockingRule(groupsOf(text), "x", "/%F0%9F%98%80/a")?.line).toBe(2);
  });

  it("accepts section rules that happen to cover any three sample pages", () => {
    expect(
      refusals("User-agent: *\nDisallow: /x\nDisallow: /0\nDisallow: /~")
    ).toEqual([]);
  });

  it("calls a block of everything with an exception the home page's only", () => {
    expect(
      refusals("User-agent: *\nDisallow: /\nAllow: /blog")[0]?.message
    ).toContain("away from the home page");
  });
});

describe("crawler names as crawlers read them", () => {
  it.each(["Googlebot*", "Googlebot/2.1", "googlebot "])(
    "reads %j as Googlebot",
    agent => {
      expect(
        refusals(`User-agent: ${agent}\nDisallow: /`)[0]?.message
      ).toContain("would keep Googlebot away from the whole site");
    }
  );

  it("keeps a crawler with a longer name apart", () => {
    expect(refusals("User-agent: Googlebot-Image\nDisallow: /")).toEqual([]);
  });
});

describe("the forms Google reads that other crawlers may not", () => {
  it.each([
    ["User-agent: Googlebot\nDissalow: /", "Googlebot"],
    ["User-agent: *\nDisallow /", "every crawler"],
    ["Useragent: Bingbot\nDisalow: /", "Bingbot"],
  ])("refuses %j, which Google reads as a whole-site rule", (text, who) => {
    expect(refusals(text)[0]?.message).toContain(
      `would keep ${who} away from the whole site`
    );
  });

  it("reads a rule with no colon, and says other crawlers may skip it", () => {
    const read = readOwnRules("User-agent: *\nDisallow /search");
    expect(read.refused).toBe(false);
    expect(read.findings).toEqual([
      {
        line: 2,
        level: "warning",
        message:
          "Line 2 has no colon after Disallow. Google reads it as a rule; other crawlers may skip it.",
      },
    ]);
    expect(blockingRule(read.groups, "x", "/search/a")?.line).toBe(2);
  });

  it("still warns about a misspelling no crawler reads", () => {
    expect(
      readOwnRules("User-agent: *\nDisalloww: /a").findings[0]
    ).toBeDefined();
    expect(
      blockingRule(groupsOf("User-agent: *\nDisalloe: /a"), "x", "/a")
    ).toBeUndefined();
  });
});

describe("an exception that opens nothing", () => {
  it("is no exception: the whole site is still refused", () => {
    const text =
      "User-agent: Googlebot\nDisallow: /\nAllow: /$\nAllow: /private\nDisallow: /private*";
    expect(refusals(text)[0]?.message).toContain(
      "would keep Googlebot away from the whole site"
    );
  });

  it("is one where it leaves a page open", () => {
    expect(
      refusals("User-agent: *\nDisallow: /\nAllow: /$\nAllow: /docs/")[0]
        ?.message
    ).toBeUndefined();
  });
});

describe("an exception judged by every page it can open", () => {
  it("is one where some page it names stays open, whatever samples are blocked", () => {
    const text =
      "User-agent: Googlebot\nDisallow: /\nAllow: /$\nAllow: /public\nDisallow: /public$\nDisallow: /publica";
    expect(refusals(text)[0]?.message ?? "").not.toContain("whole site");
  });

  it("is none where a longer rule closes every page it names", () => {
    const text =
      "User-agent: Googlebot\nDisallow: /\nAllow: /$\nAllow: /public\nDisallow: /public*";
    expect(refusals(text)[0]?.message).toContain("away from the whole site");
  });
});
