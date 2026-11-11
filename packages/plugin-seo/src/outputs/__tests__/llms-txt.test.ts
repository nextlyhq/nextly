/**
 * The site's llms.txt: its name as the heading, its description as the
 * summary, and each listed page as a link under its content type, with the
 * title and description its head carries.
 */
import { describe, expect, it } from "vitest";

import { llmsTxt } from "../llms-txt";

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
