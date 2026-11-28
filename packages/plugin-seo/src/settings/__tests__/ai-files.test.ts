/**
 * The site's choices for its files for AI tools: what an extra section's
 * links may be, how pages built in code are grouped by folder, how the
 * choices are kept, and the stored value's rule.
 */
import { describe, expect, it } from "vitest";

import {
  addressStartsWith,
  aiFilesOf,
  aiFilesProblem,
  codeFolders,
  codeGroupHeading,
  codeGroupKey,
  extraLinkProblem,
  extraLinksOf,
  folderProblem,
  headingProblem,
  leftOutInCode,
  servesFolderFiles,
  storedAiFiles,
} from "../ai-files";
import { aiFilesStoredProblem, storedAiFilesOf } from "../ai-files-stored";

describe("an extra section's links", () => {
  it("are list items of one link, with notes after a colon, to a web address or one of the site's", () => {
    expect(
      extraLinkProblem("- [API](https://api.example.com/docs)")
    ).toBeNull();
    expect(extraLinkProblem("- [Pricing](/pricing): What it costs")).toBeNull();
    expect(extraLinkProblem("just words")).toMatch(/is not a link/);
    expect(extraLinkProblem("- [Bad](javascript:alert(1))")).toMatch(
      /is not a link|not a web address/
    );
    expect(extraLinkProblem("- [Bad](ftp://example.com)")).toMatch(
      /not a web address/
    );
    // Words, not markup.
    expect(extraLinkProblem("- [<b>Bold</b>](/a)")).toMatch(/holds markup/);
    expect(extraLinkProblem("- [A](/a): see <script>")).toMatch(/holds markup/);
  });

  it("are read one a line, blank and broken lines skipped", () => {
    expect(
      extraLinksOf(
        "- [API](https://api.example.com)\n\n- [Pricing](/pricing):  What it costs \nnot a link"
      )
    ).toEqual([
      { title: "API", url: "https://api.example.com" },
      { title: "Pricing", url: "/pricing", notes: "What it costs" },
    ]);
  });

  it("go under a heading of one line of plain words", () => {
    expect(headingProblem("Docs")).toBeNull();
    expect(headingProblem(" ")).toMatch(/needs a heading/);
    expect(headingProblem("# Docs")).toMatch(/holds markup/);
    expect(headingProblem("Two\nlines")).toMatch(/one line/);
  });
});

describe("pages built in code, grouped by folder", () => {
  it("are grouped by the first part of their address where pages fill it, the folder's own page with them, the rest at the root", () => {
    const paths = ["/docs", "/docs/start", "/docs/guides/x", "/about", "/"];
    const folders = codeFolders(paths);
    expect([...folders]).toEqual(["docs"]);
    expect(codeGroupKey("/docs", folders)).toBe("code:docs");
    expect(codeGroupKey("/docs/guides/x", folders)).toBe("code:docs");
    // A page at the root is in no folder, however its address reads.
    expect(codeGroupKey("/about", folders)).toBe("code:");
    expect(codeGroupKey("/", folders)).toBe("code:");
    expect(codeGroupHeading("code:docs")).toBe("Docs");
    expect(codeGroupHeading("code:case-studies")).toBe("Case studies");
    expect(codeGroupHeading("code:")).toBe("Other pages");
  });
});

describe("addresses and folders", () => {
  it("take in a folder's own page with the pages under it", () => {
    expect(addressStartsWith("/docs/start", "/docs/")).toBe(true);
    expect(addressStartsWith("/docs", "/docs/")).toBe(true);
    expect(addressStartsWith("/docsearch", "/docs/")).toBe(false);
    expect(folderProblem("docs")).toBeNull();
    expect(folderProblem("/docs/")).toBeNull();
    expect(folderProblem("docs/guides")).toMatch(/not one folder/);
    expect(
      servesFolderFiles(
        { llmsTxt: true, aiFiles: { folderFiles: ["docs"] } },
        "docs"
      )
    ).toBe(true);
    expect(
      servesFolderFiles(
        { llmsTxt: false, aiFiles: { folderFiles: ["docs"] } },
        "docs"
      )
    ).toBe(false);
    expect(servesFolderFiles({ llmsTxt: true }, "docs")).toBe(false);
  });

  it("leave a field out where the site's code says so", () => {
    expect(leftOutInCode({ custom: { seo: { copy: false } } })).toBe(true);
    expect(leftOutInCode({ custom: { seo: { copy: true } } })).toBe(false);
    expect(leftOutInCode({})).toBe(false);
  });
});

describe("the choices, kept and checked", () => {
  it("are stored without blanks and defaults, and cleared when nothing is chosen", () => {
    expect(
      storedAiFiles({
        groups: [{ key: "posts", heading: "  " }],
        extraSections: [{ heading: " ", links: "" }],
        fullContents: { include: "everything" },
        fullMaxMegabytes: 5,
        folderFiles: ["/docs/", "docs", ""],
        copyLeftOut: { posts: [] },
      })
    ).toEqual({ groups: [{ key: "posts" }], folderFiles: ["docs"] });
    expect(storedAiFiles({})).toBeNull();
  });

  it("read back as the screen holds them, a part that is not one dropped", () => {
    const stored = {
      groups: [{ key: "posts", heading: "Writing", optional: true }, "x"],
      fullContents: { include: "addresses", prefixes: ["/docs/"] },
      fullMaxMegabytes: 7,
      copyLeftOut: { posts: ["aside", 3] },
    };
    expect(aiFilesOf(stored)).toEqual({
      groups: [{ key: "posts", heading: "Writing", optional: true }],
      fullContents: { include: "addresses", prefixes: ["/docs/"] },
      copyLeftOut: { posts: ["aside"] },
    });
  });

  it("are refused, stored, where a part breaks its rule, and read as none", () => {
    expect(
      aiFilesStoredProblem({ groups: [{ key: "posts", heading: "Writing" }] })
    ).toBeNull();
    for (const bad of [
      { extraSections: [{ heading: "Docs", links: "<b>x</b>" }] },
      { fullMaxMegabytes: 9 },
      { folderFiles: ["docs/guides"] },
      { fullContents: { include: "addresses", prefixes: ["docs"] } },
      { groups: [{ key: "posts" }, { key: "posts" }] },
      { somethingElse: true },
    ]) {
      expect(aiFilesStoredProblem(bad)).not.toBeNull();
      expect(storedAiFilesOf(bad)).toBeUndefined();
    }
    expect(storedAiFilesOf({ fullMaxMegabytes: 2 })).toEqual({
      fullMaxMegabytes: 2,
    });
  });

  it("are held up on the screen while a part is unfinished", () => {
    expect(aiFilesProblem({})).toBeNull();
    expect(
      aiFilesProblem({ fullContents: { include: "addresses", prefixes: [] } })
    ).toMatch(/Name the start/);
    expect(
      aiFilesProblem({ fullContents: { include: "groups", groups: [] } })
    ).toMatch(/Choose the sections/);
    expect(
      aiFilesProblem({ extraSections: [{ heading: "Docs", links: "" }] })
    ).toMatch(/has no links/);
    // A blank section is dropped on save, so it holds nothing up.
    expect(
      aiFilesProblem({ extraSections: [{ heading: "", links: "" }] })
    ).toBeNull();
  });
});
