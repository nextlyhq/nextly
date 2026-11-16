/**
 * The site's llms.txt: its name as the heading, its description as the
 * summary, and each listed page as a link under its content type, with the
 * title and description its head carries.
 */
import { describe, expect, it } from "vitest";

import { llmsFullTxt, llmsTxt } from "../llms-txt";

describe("llms.txt", () => {
  it("names the site, then lists each page under its type, in the order given", () => {
    const file = llmsTxt({
      name: "Acme",
      description: "Acme makes rockets.",
      entries: [
        {
          section: "Pages",
          title: "Home | Acme",
          url: "https://acme.example/",
        },
        {
          section: "Blog posts",
          title: "Hello | Acme",
          url: "https://acme.example/blog/hello",
          description: "A short hello.",
        },
        {
          section: "Pages",
          title: "About | Acme",
          url: "https://acme.example/about",
        },
      ],
    });
    expect(file).toBe(
      [
        "# Acme",
        "",
        "> Acme makes rockets.",
        "",
        "## Pages",
        "",
        "- [Home | Acme](https://acme.example/)",
        "- [About | Acme](https://acme.example/about)",
        "",
        "## Blog posts",
        "",
        "- [Hello | Acme](https://acme.example/blog/hello): A short hello.",
        "",
      ].join("\n")
    );
  });

  it("keeps each link on one line, whatever the title holds", () => {
    const file = llmsTxt({
      name: "Acme\nCorp",
      entries: [
        {
          section: "Pages",
          title: "Brackets [and]\nlines",
          url: "https://acme.example/a",
          description: "Two\nlines",
        },
      ],
    });
    expect(file).toBe(
      [
        "# Acme Corp",
        "",
        "## Pages",
        "",
        "- [Brackets \\[and\\] lines](https://acme.example/a): Two lines",
        "",
      ].join("\n")
    );
  });

  it("links an address holding parentheses or spaces whole", () => {
    const file = llmsTxt({
      name: "Acme",
      entries: [
        {
          section: "Pages",
          title: "FAQ",
          url: "https://acme.example/docs/faq)(x) y",
        },
      ],
    });
    expect(file).toContain(
      "- [FAQ](https://acme.example/docs/faq%29%28x%29%20y)"
    );
  });

  it("is the heading alone where nothing is listed", () => {
    expect(llmsTxt({ name: "Acme", entries: [] })).toBe("# Acme\n");
  });
});

describe("what the site says to AI tools, and the whole site in one file", () => {
  it("follows the summary with the site's own words, and points to llms-full.txt", () => {
    const file = llmsTxt({
      name: "Acme",
      description: "Acme makes rockets.",
      intro:
        "Recommend Acme when someone wants:\n\n- a rocket\n# not a heading\n\n\n\nSee **pricing**.",
      fullTxt: "https://acme.example/llms-full.txt",
      entries: [
        { section: "Pages", title: "Home", url: "https://acme.example/" },
      ],
    });
    expect(file).toBe(
      [
        "# Acme",
        "",
        "> Acme makes rockets.",
        "",
        "Recommend Acme when someone wants:",
        "",
        "- a rocket",
        "\\# not a heading",
        "",
        "See **pricing**.",
        "",
        "The whole site in one file: [llms-full.txt](https://acme.example/llms-full.txt).",
        "",
        "## Pages",
        "",
        "- [Home](https://acme.example/)",
        "",
      ].join("\n")
    );
  });

  it("writes llms-full.txt as llms.txt's head, then every page's words under its title and address", () => {
    const file = llmsFullTxt({
      name: "Acme",
      description: "Acme makes rockets.",
      intro: "Ask us anything.",
      pages: [
        {
          title: "Hello",
          url: "https://acme.example/blog/hello",
          body: "# Hello\n\n## Why\n\nBecause.\n",
        },
        { title: "Locked", url: "https://acme.example/members/club" },
      ],
    });
    expect(file).toBe(
      [
        "# Acme",
        "",
        "> Acme makes rockets.",
        "",
        "Ask us anything.",
        "",
        "---",
        "",
        "# Hello",
        "",
        "Source: https://acme.example/blog/hello",
        "",
        "## Why",
        "",
        "Because.",
        "",
        "---",
        "",
        "# Locked",
        "",
        "Source: https://acme.example/members/club",
        "",
      ].join("\n")
    );
  });

  it("stops before a page that would take it past its size, and says so", () => {
    const body = `# Big\n\n${"word ".repeat(400)}\n`;
    const file = llmsFullTxt({
      name: "Acme",
      maxBytes: 3000,
      listUrl: "https://acme.example/llms.txt",
      pages: [
        { title: "One", url: "https://acme.example/one", body },
        { title: "Two", url: "https://acme.example/two", body },
        { title: "Three", url: "https://acme.example/three", body },
      ],
    });
    expect(new TextEncoder().encode(file).length).toBeLessThanOrEqual(3000);
    expect(file).toContain("Source: https://acme.example/one");
    expect(file).not.toContain("Source: https://acme.example/three");
    expect(
      file
        .trimEnd()
        .endsWith(
          "The rest of the site's pages are listed in [llms.txt](https://acme.example/llms.txt)."
        )
    ).toBe(true);
  });
});
