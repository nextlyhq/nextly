import { describe, expect, it } from "vitest";

import {
  checkDocsCompile,
  compileFinding,
  withoutFrontmatter,
} from "./check-docs-compile.mjs";

const FRONTMATTER = "---\ntitle: Releases\ndescription: One line.\n---\n";

describe("withoutFrontmatter", () => {
  it("takes the opening block off and counts its lines", () => {
    expect(withoutFrontmatter(`${FRONTMATTER}# Body\n`)).toEqual({
      body: "# Body\n",
      skipped: 4,
    });
  });

  it("leaves a page with none alone", () => {
    expect(
      withoutFrontmatter("# Body\n\n---\n\nrule, not frontmatter\n")
    ).toEqual({
      body: "# Body\n\n---\n\nrule, not frontmatter\n",
      skipped: 0,
    });
  });
});

describe("compileFinding", () => {
  it("is null for a page that compiles, components included", async () => {
    expect(
      await compileFinding(
        `${FRONTMATTER}<Callout type="warn">\n\n1. one\n2. two\n\n</Callout>\n`
      )
    ).toBeNull();
  });

  it("reports a closing tag indented under a list item, at the file's own line", async () => {
    // The shape that broke the site: the tag closes inside the list item the
    // indentation put it in. Line 7 of the FILE, not of the body the
    // frontmatter was taken off.
    const finding = await compileFinding(
      `${FRONTMATTER}<Callout type="warn">\n\n1. one\n   </Callout>\n`
    );
    expect(finding).not.toBeNull();
    expect(finding.where).toBe(":8:4");
    expect(finding.message).toContain("Expected the closing tag `</Callout>`");
  });
});

describe("components a page uses", () => {
  it("passes a component the site registers, and HTML tags", async () => {
    expect(
      await compileFinding(
        `${FRONTMATTER}<Callout>ok</Callout>\n\n<div>html</div>\n`
      )
    ).toBeNull();
  });

  it("reports a component the site never registered", async () => {
    // Compiles fine; the site throws at render for it. The shape that shipped.
    const finding = await compileFinding(
      `${FRONTMATTER}<Warning>\nNot yet.\n</Warning>\n`
    );
    expect(finding).not.toBeNull();
    expect(finding.message).toContain("<Warning>");
    expect(finding.message).toContain("does not register");
  });

  it("does not mistake a generic in a code sample for a component", async () => {
    expect(
      await compileFinding(
        `${FRONTMATTER}\`\`\`ts\nconst x: Promise<T> = f<ReturnType<F>>();\n\`\`\`\n`
      )
    ).toBeNull();
  });
});

describe("the committed pages", () => {
  it("all compile, and there are pages", async () => {
    const { pages, findings } = await checkDocsCompile(process.cwd());
    expect(pages).toBeGreaterThan(50);
    expect(findings).toEqual([]);
  });
});
