import { describe, expect, it } from "vitest";

import {
  allowedComponents,
  checkDocsCompile,
  compileFinding,
  frontmatterFinding,
  splitFrontmatter,
} from "./check-docs-compile.mjs";

const FRONTMATTER = "---\ntitle: Releases\ndescription: One line.\n---\n";
const ALLOWED = new Set(["Callout", "Tabs", "Tab"]);
const finding = source => compileFinding(source, ALLOWED);

describe("splitFrontmatter", () => {
  it("takes the opening block off, parses it, and counts its lines", () => {
    expect(splitFrontmatter(`${FRONTMATTER}# Body\n`)).toEqual({
      body: "# Body\n",
      skipped: 4,
      data: { title: "Releases", description: "One line." },
    });
  });

  it("leaves a page with none alone", () => {
    expect(
      splitFrontmatter("# Body\n\n---\n\nrule, not frontmatter\n")
    ).toEqual({
      body: "# Body\n\n---\n\nrule, not frontmatter\n",
      skipped: 0,
      data: {},
    });
  });
});

describe("frontmatterFinding", () => {
  it("accepts what the site's page schema accepts", () => {
    expect(
      frontmatterFinding({
        title: "T",
        description: "d",
        icon: "i",
        full: true,
      })
    ).toBeNull();
  });

  it("requires a title", () => {
    expect(frontmatterFinding({})).toContain("no title");
    expect(frontmatterFinding({ title: "" })).toContain("no title");
    expect(frontmatterFinding({ title: 3 })).toContain("no title");
  });

  it("refuses a field of the wrong type", () => {
    expect(frontmatterFinding({ title: "T", description: ["x"] })).toContain(
      "description"
    );
    expect(frontmatterFinding({ title: "T", full: "yes" })).toContain("full");
  });
});

describe("compileFinding", () => {
  it("is null for a page that compiles, components included", async () => {
    expect(
      await finding(
        `${FRONTMATTER}<Callout type="warn">\n\n1. one\n2. two\n\n</Callout>\n`
      )
    ).toBeNull();
  });

  it("reports a closing tag indented under a list item, at the file's own line", async () => {
    // The shape that broke the site: the tag closes inside the list item the
    // indentation put it in. Line 8 of the FILE, not of the body the
    // frontmatter was taken off.
    const found = await finding(
      `${FRONTMATTER}<Callout type="warn">\n\n1. one\n   </Callout>\n`
    );
    expect(found).not.toBeNull();
    expect(found.where).toBe(":8:4");
    expect(found.message).toContain("Expected the closing tag `</Callout>`");
  });

  it("reports frontmatter that is not YAML before compiling the body", async () => {
    // The body is fine; the site's loader never gets that far.
    const found = await finding("---\ntitle: [unterminated\n---\n# Fine\n");
    expect(found).not.toBeNull();
    expect(found.where).toBe(":1");
    expect(found.message).toContain("not YAML");
  });

  it("reports frontmatter the site's schema refuses", async () => {
    const found = await finding(
      "---\ndescription: no title here\n---\n# Fine\n"
    );
    expect(found.message).toContain("no title");
  });
});

describe("components a page uses", () => {
  it("passes a component the contract lists, and HTML tags", async () => {
    expect(
      await finding(`${FRONTMATTER}<Callout>ok</Callout>\n\n<div>html</div>\n`)
    ).toBeNull();
  });

  it("reports a component the contract does not list", async () => {
    // Compiles fine; the site throws at render for it. The shape that shipped.
    const found = await finding(
      `${FRONTMATTER}<Warning>\nNot yet.\n</Warning>\n`
    );
    expect(found).not.toBeNull();
    expect(found.message).toContain("<Warning>");
    expect(found.message).toContain("does not list");
  });

  it("finds a component inside an MDX expression", async () => {
    // `{cond && <Warning />}` keeps its JSX in the expression's ESTree, not
    // in the tree's children. The Callout beside it is the control that the
    // expression walk does not also lose what the tree walk finds.
    const found = await finding(
      `${FRONTMATTER}export const cond = true;\n\n{cond && <Warning />}\n\n<Callout>ok</Callout>\n`
    );
    expect(found).not.toBeNull();
    expect(found.message).toContain("<Warning>");
    expect(found.message).not.toContain("<Callout>");
  });

  it("reads a member expression's root, so <Foo.Bar> is held to Foo", async () => {
    expect((await finding(`${FRONTMATTER}<Foo.Bar />\n`)).message).toContain(
      "<Foo>"
    );
  });

  it("does not mistake a generic in a code sample for a component", async () => {
    expect(
      await finding(
        `${FRONTMATTER}\`\`\`ts\nconst x: Promise<T> = f<ReturnType<F>>();\n\`\`\`\n`
      )
    ).toBeNull();
  });
});

describe("the contract", () => {
  it("is a list of names the docs really use, read from beside the pages", () => {
    const allowed = allowedComponents(process.cwd());
    expect(allowed.size).toBeGreaterThan(0);
    for (const name of ["Callout", "Tabs", "Tab"])
      expect(allowed.has(name)).toBe(true);
  });
});

describe("the committed pages", () => {
  it("all compile against the contract, and there are pages", async () => {
    const { pages, findings } = await checkDocsCompile(process.cwd());
    expect(pages).toBeGreaterThan(50);
    expect(findings).toEqual([]);
  });
});
