import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  digestLine,
  namesRetiredCategory,
  packageKeywords,
  renderedProse,
  runChecks,
  splitRefAndPath,
} from "./check-docs-claims.mjs";

/**
 * Each fixture exhibits exactly one defect, and every check is asserted twice:
 * once on a tree that has the defect, once on the nearest tree that does not.
 * A check that only ever passes has not been shown to work, and the negative
 * case is what distinguishes "the check fired" from "the check fires on
 * anything".
 */
/**
 * Returns the root AND the file list, because the checker reads git's index rather than the
 * disk. A fixture directory is not a git repository, so the list is injected — and injecting it
 * is also what keeps a stray file in the temp directory from changing a result.
 */
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "docs-claims-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return { root, files: Object.keys(files) };
}

const pkg = (extra = {}) =>
  JSON.stringify({ name: "@nextlyhq/thing", version: "0.0.2-alpha.62", ...extra });

const REFS = new Set(["main", "feature/docs-refresh", "v1.2.3"]);

async function checksFor(spec, opts = {}) {
  const { root, files } = await fixture(spec);
  const { findings } = await runChecks({
    repoRoot: root,
    files,
    remoteRefs: REFS,
    hasLocalCommit: () => true,
    ...opts,
  });
  return findings.map(f => f.check);
}

describe("readme-present", () => {
  it("fires when a published package has no README", async () => {
    expect(await checksFor({ "packages/thing/package.json": pkg() })).toContain(
      "readme-present"
    );
  });

  it("does not fire for a private package", async () => {
    expect(
      await checksFor({ "packages/thing/package.json": pkg({ private: true }) })
    ).not.toContain("readme-present");
  });
});

describe("root-readme-lists-package", () => {
  it("fires when a published package is absent from the root README", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md": "# thing\n",
      })
    ).toContain("root-readme-lists-package");
  });

  it("does not fire once the root README names it", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n| **@nextlyhq/thing** | does a thing |\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md": "# thing\n",
      })
    ).not.toContain("root-readme-lists-package");
  });
});

describe("forbidden-status-phrase", () => {
  it("fires on 'coming soon' in a published package README", async () => {
    expect(
      await checksFor({
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md": "# thing\n\nComing soon in beta.\n",
      })
    ).toContain("forbidden-status-phrase");
  });

  it("fires on 'not ready for use' in a docs page", async () => {
    expect(
      await checksFor({ "docs/a.mdx": "Plugins are not ready for use yet.\n" })
    ).toContain("forbidden-status-phrase");
  });

  it("does not fire inside a CHANGELOG, which is a historical record", async () => {
    expect(
      await checksFor({
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md": "# thing\n",
        "packages/thing/CHANGELOG.md": "Coming soon in beta.\n",
      })
    ).not.toContain("forbidden-status-phrase");
  });

  it("does not fire on an allowlisted line", async () => {
    const exempt = "returns a coming soon placeholder";
    const { root, files } = await fixture({ "docs/a.mdx": `${exempt}\n` });
    const { findings } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
      allowlist: {
        "forbidden-status-phrase": {
          "docs/a.mdx": { count: 1, digests: [digestLine(exempt)] },
        },
      },
    });
    expect(findings.map(f => f.check)).not.toContain("forbidden-status-phrase");
  });

  it("still fires on a DIFFERENT claim in the same allowlisted file", async () => {
    const exempt = "returns a coming soon placeholder";
    const { root, files } = await fixture({
      "docs/a.mdx": `${exempt}\nPlugins are not ready for use yet.\n`,
    });
    const { findings } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
      allowlist: {
        "forbidden-status-phrase": {
          "docs/a.mdx": { count: 1, digests: [digestLine(exempt)] },
        },
      },
    });
    const hits = findings.filter(f => f.check === "forbidden-status-phrase");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });
});

describe("naming-rule", () => {
  it("fires on the bare phrase Visual Builder", async () => {
    expect(await checksFor({ "docs/a.mdx": "The Visual Builder does things.\n" })).toContain(
      "naming-rule"
    );
  });

  it("does not fire on the two qualified forms", async () => {
    expect(
      await checksFor({
        "docs/a.mdx": "The Visual Schema Builder and the Visual Page Builder.\n",
      })
    ).not.toContain("naming-rule");
  });
});

describe("retired-category", () => {
  it("declares only surfaces that exist, so a rename cannot drop one silently", async () => {
    const { CATEGORY_SURFACES } = await import("./check-docs-claims.mjs");
    const { existsSync } = await import("node:fs");
    const missing = CATEGORY_SURFACES.filter(rel => !existsSync(rel));
    expect(missing).toEqual([]);
  });

  it("fires when a surface that states the category uses the retired one", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "Nextly is an app framework for Next.js.\n" })
    ).toContain("retired-category");
  });

  it("fires on the hyphenated spelling", async () => {
    expect(
      await checksFor({ "AGENTS.md": "A TypeScript CMS/app-framework monorepo.\n" })
    ).toContain("retired-category");
  });

  it("fires on the plural, which claims the same category", async () => {
    expect(
      await checksFor({ "README.md": "Nextly is one of several app frameworks.\n" })
    ).toContain("retired-category");
  });

  it("fires through a tag around one word of the phrase", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "Nextly is an app <strong>framework</strong>.\n" })
    ).toContain("retired-category");
  });

  it("fires through emphasis, an inline link and a reference link", async () => {
    for (const body of [
      "Nextly is an app **framework**.\n",
      "Nextly is an app [framework](/x).\n",
      "Nextly is an app [framework][term].\n",
    ]) {
      expect(await checksFor({ "docs/index.mdx": body })).toContain("retired-category");
    }
  });

  it("fires when a soft wrap splits the phrase", async () => {
    expect(
      await checksFor({ "AGENTS.md": "Nextly is an app\nframework for Next.js.\n" })
    ).toContain("retired-category");
  });

  it("fires on a published package description", async () => {
    expect(
      await checksFor({
        "packages/nextly/package.json": JSON.stringify({
          name: "nextly",
          version: "1.0.0",
          description: "Nextly is an app framework for Next.js.",
        }),
      })
    ).toContain("retired-category");
  });

  it("does not read an mdx comment as prose", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "a\n\n{/* once an app framework */}\n\nb\n" })
    ).not.toContain("retired-category");
  });

  it("does not read a code span that spans lines as a claim", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "Compare `an\napp framework\nliteral` here.\n" })
    ).not.toContain("retired-category");
  });

  it("does not run two list items together into a phrase", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "Notes:\n\n- app\n- framework\n" })
    ).not.toContain("retired-category");
  });

  it("fires when a quotation wraps across its lines", async () => {
    expect(
      await checksFor({ "README.md": "> Nextly is an app\n> framework for Next.js.\n" })
    ).toContain("retired-category");
  });

  it("leaves a published keyword to the check that owns keywords", async () => {
    // Still caught, under one name rather than two. `retired-category` reads the
    // description; `retired-category-keyword` reads the keywords.
    const checks = await checksFor({
      "packages/nextly/package.json": JSON.stringify({
        name: "nextly",
        version: "1.0.0",
        description: "A content platform.",
        keywords: ["cms", "app-framework"],
      }),
    });
    expect(checks).toContain("retired-category-keyword");
    expect(checks).not.toContain("retired-category");
  });

  it("does not read a heading as running into the paragraph beneath it", async () => {
    expect(
      await checksFor({ "README.md": "## App\nFramework notes follow here.\n" })
    ).not.toContain("retired-category");
  });

  it("does not read an mdx import as prose", async () => {
    expect(
      await checksFor({ "docs/index.mdx": 'import D from "./x/app-framework.mjs";\n\nHello.\n' })
    ).not.toContain("retired-category");
  });

  it("fires when a space entity stands between the words", async () => {
    for (const body of ["an app&nbsp;framework.\n", "an app&#160;framework.\n"]) {
      expect(await checksFor({ "docs/index.mdx": body })).toContain("retired-category");
    }
  });

  it("does not join a paragraph into the quotation beneath it", async () => {
    // `App\n> Framework configuration.` renders as a paragraph and then a
    // separate blockquote, so the two words never meet.
    expect(
      await checksFor({ "README.md": "App\n> Framework configuration.\n" })
    ).not.toContain("retired-category");
  });

  it("reads an unprefixed line beneath a quotation as continuing it", async () => {
    // The other direction is not a boundary: `> Nextly is an app\nframework.`
    // renders as one paragraph inside the quotation.
    expect(
      await checksFor({ "README.md": "> Nextly is an app\nframework for Next.js.\n" })
    ).toContain("retired-category");
  });

  it("does not leave prose behind when a wide code span holds a shorter run", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "Compare ``foo` app framework `` literally.\n" })
    ).not.toContain("retired-category");
  });

  it("does not read an mdx import that wraps across lines", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": 'import {\n  Demo,\n} from "./examples/app-framework.mjs";\n\nHello.\n',
      })
    ).not.toContain("retired-category");
  });

  it("does not join manifest fields into a phrase neither one contains", async () => {
    expect(
      await checksFor({
        "packages/nextly/package.json": JSON.stringify({
          name: "nextly",
          version: "1.0.0",
          description: "CLI for your Next.js app",
          keywords: ["framework", "cms"],
        }),
      })
    ).not.toContain("retired-category");
  });

  it("does not read a heading as running on, wherever it sits in the block", async () => {
    expect(
      await checksFor({ "README.md": "Intro.\n## App\nFramework configuration.\n" })
    ).not.toContain("retired-category");
  });

  it("reads a Markdown line beginning with import as prose, not a statement", async () => {
    expect(
      await checksFor({
        "AGENTS.md": "Nextly lets developers\nimport Nextly as an app framework today.\n",
      })
    ).toContain("retired-category");
  });

  it("fires when a line break carries the space between the words", async () => {
    for (const body of ["Nextly is an app<br/>framework.\n", "Nextly is an app\\\nframework.\n"]) {
      expect(await checksFor({ "README.md": body })).toContain("retired-category");
    }
  });

  it("does not read an html code element as a claim", async () => {
    expect(
      await checksFor({ "README.md": "Use <code>app framework</code> literally.\n" })
    ).not.toContain("retired-category");
  });

  it("reads a page's published title and description out of its frontmatter", async () => {
    for (const front of ["title: The app framework", "description: Nextly is an app framework."]) {
      expect(
        await checksFor({ "docs/index.mdx": `---\n${front}\n---\n\nHello.\n` })
      ).toContain("retired-category");
    }
  });

  it("does not read the rest of the frontmatter, but still reads the body", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "---\nlegacy: app framework\n---\n\nHello.\n" })
    ).not.toContain("retired-category");
    expect(
      await checksFor({ "docs/index.mdx": "---\ntitle: Docs\n---\n\nNextly is an app framework.\n" })
    ).toContain("retired-category");
  });

  it("decodes every spelling of the separators", async () => {
    for (const body of [
      "an app&#x20;framework.\n",
      "an app&#45;framework.\n",
      "an app&#x2d;framework.\n",
    ]) {
      expect(await checksFor({ "docs/index.mdx": body })).toContain("retired-category");
    }
  });

  it("reads a frontmatter value written as a folded or literal scalar", async () => {
    for (const marker of [">-", "|"]) {
      expect(
        await checksFor({
          "docs/index.mdx": `---\ndescription: ${marker}\n  Nextly is an app framework.\n---\n\nHi.\n`,
        })
      ).toContain("retired-category");
    }
  });

  it("reads an image's alternative text, which a reader is shown", async () => {
    expect(
      await checksFor({
        "README.md": '<img src="x.png" alt="Nextly is an app framework" />\n',
      })
    ).toContain("retired-category");
  });

  it("recognises frontmatter terminated by CRLF or by end of file", async () => {
    for (const body of ["---\r\nlegacy: app framework\r\n---\r\n\r\nHi.\n", "---\nlegacy: app framework\n---"]) {
      expect(await checksFor({ "docs/index.mdx": body })).not.toContain("retired-category");
    }
  });

  it("reads a diagram's labels, which are drawn for the reader", async () => {
    expect(
      await checksFor({
        "ARCHITECTURE.md": 'Intro.\n\n```mermaid\ngraph TD\n  N["Nextly app framework"]\n```\n\nTail.\n',
      })
    ).toContain("retired-category");
  });

  it("reads an indented mdx line as list content, not module syntax", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": "- Nextly lets developers\n  import Nextly as an app framework.\n",
      })
    ).toContain("retired-category");
  });

  it("does not read a yaml comment as part of the published value", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": "---\ndescription: A content platform # formerly an app framework\n---\n\nHi.\n",
      })
    ).not.toContain("retired-category");
  });

  it("reads a block scalar that has a blank line inside it", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": "---\ndescription: >-\n  Nextly is an app\n\n  framework for Next.js.\n---\n\nHi.\n",
      })
    ).toContain("retired-category");
  });

  it("reads a round mermaid node as well as a square one", async () => {
    expect(
      await checksFor({
        "ARCHITECTURE.md": "Intro.\n\n```mermaid\ngraph TD\n  N(Nextly app framework)\n```\n\nTail.\n",
      })
    ).toContain("retired-category");
  });

  it("reads escaped punctuation as the mark it renders", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "Nextly is an app\\-framework for Next.js.\n" })
    ).toContain("retired-category");
  });

  it("does not read a comment that follows a quoted value", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": '---\ndescription: "A content platform" # formerly an app framework\n---\n\nHi.\n',
      })
    ).not.toContain("retired-category");
    expect(
      await checksFor({ "docs/index.mdx": '---\ndescription: "Nextly is an app framework"\n---\n\nHi.\n' })
    ).toContain("retired-category");
  });

  it("honours an allowlist entry written with posix separators", async () => {
    const claim = "Nextly is an app framework.";
    const { root, files } = await fixture({ "docs/index.mdx": `${claim}\n` });
    const { findings } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
      allowlist: {
        "retired-category": { "docs/index.mdx": { count: 1, digests: [digestLine(claim)] } },
      },
    });
    expect(findings.filter(f => f.check === "retired-category")).toHaveLength(0);
  });

  it("reads a mermaid edge label", async () => {
    expect(
      await checksFor({
        "ARCHITECTURE.md": "I.\n\n```mermaid\ngraph TD\n  A -->|Nextly app framework| B\n```\n\nT.\n",
      })
    ).toContain("retired-category");
  });

  it("reads the captions a component is given, and only those", async () => {
    expect(
      await checksFor({ "docs/index.mdx": '<Tabs items={["app framework", "cms"]}>\n\nHi.\n' })
    ).toContain("retired-category");
    expect(
      await checksFor({ "docs/index.mdx": '<Callout title="Nextly is an app framework">\n\nHi.\n' })
    ).toContain("retired-category");
    expect(
      await checksFor({ "docs/index.mdx": '<Tabs items={["content platform", "cms"]}>\n\nHi.\n' })
    ).not.toContain("retired-category");
  });

  it("does not read a component's configuration as a caption", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": '<Tabs items={["content platform"]} className="app-framework">\n\nHi.\n',
      })
    ).not.toContain("retired-category");
  });

  it("reads a brace-delimited mermaid node", async () => {
    expect(
      await checksFor({
        "ARCHITECTURE.md": "I.\n\n```mermaid\ngraph TD\n  A{Nextly app framework}\n```\n\nT.\n",
      })
    ).toContain("retired-category");
  });

  it("does not read a link definition, which renders no text", async () => {
    expect(
      await checksFor({ "README.md": "[legacy]: https://example.com/app-framework\n\nHi.\n" })
    ).not.toContain("retired-category");
  });

  it("removes module syntax with a punctuator after the keyword", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": 'export{default as Demo}from "./app-framework.mjs";\n\nHi.\n',
      })
    ).not.toContain("retired-category");
  });

  it("decodes escapes inside a double-quoted frontmatter value", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": '---\ndescription: "Nextly is an app\\x20framework"\n---\n\nHi.\n',
      })
    ).toContain("retired-category");
  });

  it("reads a single-quoted yaml value that escapes a quote by doubling it", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": "---\ndescription: 'Nextly''s app framework for Next.js'\n---\n\nHi.\n",
      })
    ).toContain("retired-category");
  });

  it("does not read an array passed to a prop that draws nothing", async () => {
    expect(
      await checksFor({ "docs/index.mdx": '<Widget classNames={["app-framework"]}>\n\nHi.\n' })
    ).not.toContain("retired-category");
  });

  it("does not read a mermaid click target as a label", async () => {
    expect(
      await checksFor({
        "ARCHITECTURE.md":
          'I.\n\n```mermaid\ngraph TD\n  A["Nextly"]\n  click A "https://example.com/app-framework"\n```\n\nT.\n',
      })
    ).not.toContain("retired-category");
  });

  it("reads keywords given as a bare string, which npm accepts", async () => {
    const checks = await checksFor({
      "packages/nextly/package.json": JSON.stringify({
        name: "nextly",
        version: "1.0.0",
        description: "A content platform.",
        keywords: "app-framework",
      }),
    });
    expect(checks).toContain("retired-category-keyword");
    expect(checks).not.toContain("retired-category");
  });

  it("does not decode escapes in a single-quoted yaml value, which are literal", async () => {
    expect(
      await checksFor({
        "docs/index.mdx": "---\ndescription: 'Nextly is an app\\x20framework'\n---\n\nHi.\n",
      })
    ).not.toContain("retired-category");
  });

  it("reads a mermaid click tooltip but not its target", async () => {
    expect(
      await checksFor({
        "ARCHITECTURE.md":
          'I.\n\n```mermaid\ngraph TD\n  A["N"]\n  click A "https://example.test" "Nextly is an app framework"\n```\n\nT.\n',
      })
    ).toContain("retired-category");
    expect(
      await checksFor({
        "ARCHITECTURE.md":
          'I.\n\n```mermaid\ngraph TD\n  A["N"]\n  click A "https://example.com/app-framework"\n```\n\nT.\n',
      })
    ).not.toContain("retired-category");
  });

  it("does not continue a quotation into a block that opens its own line", async () => {
    expect(
      await checksFor({
        "README.md": '> Configure the Nextly app\n<Callout title="Framework settings">\n',
      })
    ).not.toContain("retired-category");
  });

  it("reads a mermaid tooltip in the callback form, which carries no address", async () => {
    expect(
      await checksFor({
        "ARCHITECTURE.md":
          'I.\n\n```mermaid\ngraph TD\n  A["N"]\n  click A callback "Nextly is an app framework"\n```\n\nT.\n',
      })
    ).toContain("retired-category");
  });

  it("does not continue a quotation into an html block, but keeps an inline tag", async () => {
    expect(
      await checksFor({ "README.md": "> Configure the Nextly app\n<div>Framework settings</div>\n" })
    ).not.toContain("retired-category");
    expect(
      await checksFor({ "README.md": "Configure the Nextly <b>app framework</b> here.\n" })
    ).toContain("retired-category");
  });

  it("does not fire on the category that replaced it", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "Nextly is an open-source content platform.\n" })
    ).not.toContain("retired-category");
  });

  it("does not read a fenced example as the project describing itself", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "intro\n\n```\napp framework\n```\n\ntail\n" })
    ).not.toContain("retired-category");
  });

  it("does not read a commented-out block as prose", async () => {
    expect(
      await checksFor({ "docs/index.mdx": "a\n<!--\napp framework\n-->\nb\n" })
    ).not.toContain("retired-category");
  });

  it("does not read a code span as a claim, at any delimiter width", async () => {
    expect(
      await checksFor({ "ARCHITECTURE.md": "Compare ``app framework`` and `app framework`.\n" })
    ).not.toContain("retired-category");
  });

  it("does not read a document that states no category", async () => {
    expect(
      await checksFor({ "docs/guides/tutorial.mdx": "Nextly is an app framework.\n" })
    ).not.toContain("retired-category");
  });

  it("reports the file rather than a line, and reports it once", async () => {
    const { root, files } = await fixture({
      "docs/index.mdx": "Nextly is an app framework.\nStill an app framework here.\n",
    });
    const { findings } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
    });
    const hits = findings.filter(f => f.check === "retired-category");
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("docs/index.mdx");
    expect(hits[0].line).toBeNull();
  });
});

describe("dead-branch-link", () => {
  it("fires when a linked ref does not resolve", async () => {
    expect(
      await checksFor({ "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/dev/x.ts\n" })
    ).toContain("dead-branch-link");
  });

  it("does not fire for a ref that resolves", async () => {
    expect(
      await checksFor({ "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/main/x.ts\n" })
    ).not.toContain("dead-branch-link");
  });

  it("accepts a ref containing slashes, which git permits", async () => {
    expect(
      await checksFor({
        "docs/a.mdx":
          "https://github.com/nextlyhq/nextly/blob/feature/docs-refresh/docs/x.mdx\n",
      })
    ).not.toContain("dead-branch-link");
  });

  it("still fires on a dead multi-segment ref", async () => {
    expect(
      await checksFor({
        "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/feature/gone/docs/x.mdx\n",
      })
    ).toContain("dead-branch-link");
  });

  it("reports a pinned commit the clone does not hold as unverifiable, not dead", async () => {
    const { root, files } = await fixture({
      "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/deadbeef/missing.md\n",
    });
    const { findings, unverifiable } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => false,
    });
    expect(findings.map(f => f.check)).not.toContain("dead-branch-link");
    expect(unverifiable.some(u => u.ref === "deadbeef")).toBe(true);
  });

  it("accepts a pinned commit the clone does hold", async () => {
    const { root, files } = await fixture({
      "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/deadbeef/x.md\n",
    });
    const { findings, unverifiable } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
    });
    expect(findings.map(f => f.check)).not.toContain("dead-branch-link");
    expect(unverifiable).toHaveLength(0);
  });

  it("reports unverifiable rather than failing when the remote is unreachable", async () => {
    const { root, files } = await fixture({
      "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/dev/x.ts\n",
    });
    const { findings, unverifiable } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: null,
      hasLocalCommit: () => false,
    });
    expect(findings.map(f => f.check)).not.toContain("dead-branch-link");
    expect(unverifiable.length).toBeGreaterThan(0);
  });

  it("resolves the longest matching ref prefix, not the first segment", () => {
    expect(splitRefAndPath("feature/docs-refresh/docs/x.mdx", REFS)).toEqual({
      ref: "feature/docs-refresh",
      resolved: true,
    });
  });
});

describe("meta-reachable", () => {
  it("fires when an mdx page is unreachable from meta.json", async () => {
    expect(
      await checksFor({
        "docs/meta.json": JSON.stringify({ pages: ["index"] }),
        "docs/index.mdx": "# i\n",
        "docs/orphan.mdx": "# o\n",
      })
    ).toContain("meta-reachable");
  });

  it("does not fire once the page is listed", async () => {
    expect(
      await checksFor({
        "docs/meta.json": JSON.stringify({ pages: ["index", "orphan"] }),
        "docs/index.mdx": "# i\n",
        "docs/orphan.mdx": "# o\n",
      })
    ).not.toContain("meta-reachable");
  });
});

describe("unreadable metadata", () => {
  it("fires on a meta.json that will not parse", async () => {
    expect(
      await checksFor({ "docs/meta.json": "{ not json", "docs/a.mdx": "# a\n" })
    ).toContain("unreadable-meta");
  });

  it("fires on a package.json that will not parse", async () => {
    expect(await checksFor({ "packages/thing/package.json": "{ nope" })).toContain(
      "unreadable-manifest"
    );
  });
});

describe("root-readme-present", () => {
  it("fires when published packages exist but the root README does not", async () => {
    expect(
      await checksFor({
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md": "# thing\n",
      })
    ).toContain("root-readme-present");
  });

  it("does not fire when there are no published packages", async () => {
    expect(await checksFor({ "docs/a.mdx": "# a\n" })).not.toContain("root-readme-present");
  });
});

describe("changeset scoping", () => {
  it("does not fire the phrase check on a changeset quoting a claim it removed", async () => {
    expect(
      await checksFor({
        ".changeset/x.md": 'The README said "Plugins are not ready for use yet". It no longer does.\n',
      })
    ).not.toContain("forbidden-status-phrase");
  });

  it("still fires the naming rule on a changeset, which becomes a CHANGELOG entry", async () => {
    expect(
      await checksFor({ ".changeset/x.md": "Reject a field through the visual builder.\n" })
    ).toContain("naming-rule");
  });
});

describe("enumeration comes from the injected file list, not the disk", () => {
  it("ignores a file on disk that is not in the list", async () => {
    const { root } = await fixture({ "docs/tracked.mdx": "# fine\n" });
    await writeFile(join(root, "docs", "untracked.mdx"), "The Visual Builder is here.\n");
    const { findings } = await runChecks({
      repoRoot: root,
      files: ["docs/tracked.mdx"],
      remoteRefs: REFS,
      hasLocalCommit: () => true,
    });
    expect(findings.map(f => f.check)).not.toContain("naming-rule");
  });

  it("reports it once the same file is in the list", async () => {
    const { root } = await fixture({ "docs/tracked.mdx": "# fine\n" });
    await writeFile(join(root, "docs", "untracked.mdx"), "The Visual Builder is here.\n");
    const { findings } = await runChecks({
      repoRoot: root,
      files: ["docs/tracked.mdx", "docs/untracked.mdx"],
      remoteRefs: REFS,
      hasLocalCommit: () => true,
    });
    expect(findings.map(f => f.check)).toContain("naming-rule");
  });
});

describe("meta.json is consulted only when tracked", () => {
  it("does not invent an orphan from a meta.json the clone will not have", async () => {
    // The file exists in this working tree but not in the index. A clone therefore has no
    // meta.json for this directory, fumadocs auto-includes its pages, and nothing is orphaned.
    // Reading the disk here would report a finding that cannot happen on the site.
    const { root } = await fixture({
      "docs/meta.json": JSON.stringify({ pages: ["index"] }),
      "docs/index.mdx": "# i\n",
      "docs/orphan.mdx": "# o\n",
    });
    const { findings } = await runChecks({
      repoRoot: root,
      files: ["docs/index.mdx", "docs/orphan.mdx"],
      remoteRefs: REFS,
      hasLocalCommit: () => true,
    });
    expect(findings.map(f => f.check)).not.toContain("meta-reachable");
  });

  it("still catches the orphan once meta.json is tracked", async () => {
    const { root, files } = await fixture({
      "docs/meta.json": JSON.stringify({ pages: ["index"] }),
      "docs/index.mdx": "# i\n",
      "docs/orphan.mdx": "# o\n",
    });
    const { findings } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
    });
    expect(findings.map(f => f.check)).toContain("meta-reachable");
  });
});

describe("internal-docs-link", () => {
  it("fires on a link to a docs page that does not exist", async () => {
    expect(
      await checksFor({ "docs/a.mdx": "See [gone](/docs/nope) for more.\n" })
    ).toContain("internal-docs-link");
  });

  it("does not fire when the target exists as a file", async () => {
    expect(
      await checksFor({
        "docs/a.mdx": "See [b](/docs/b) for more.\n",
        "docs/b.mdx": "# b\n",
      })
    ).not.toContain("internal-docs-link");
  });

  it("resolves a directory target through its index page", async () => {
    expect(
      await checksFor({
        "docs/a.mdx": "See [preview](/docs/preview) for more.\n",
        "docs/preview/index.mdx": "# preview\n",
      })
    ).not.toContain("internal-docs-link");
  });

  it("ignores the anchor when resolving", async () => {
    expect(
      await checksFor({
        "docs/a.mdx": "See [b](/docs/b#a-heading) for more.\n",
        "docs/b.mdx": "# b\n",
      })
    ).not.toContain("internal-docs-link");
  });
});

describe("readme-skeleton", () => {
  const full = [
    "# @nextlyhq/thing",
    "",
    "Nextly is in alpha. APIs may change before 1.0.",
    "",
    "## Install",
    "",
    "## Related packages",
    "",
    "## License",
    "",
  ].join("\n");

  it("passes a README carrying all four sections", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md": full,
      })
    ).not.toContain("readme-skeleton");
  });

  it("fires once per missing section, naming which", async () => {
    const { root, files } = await fixture({
      "README.md": "# nextly\n\n@nextlyhq/thing\n",
      "packages/thing/package.json": pkg(),
      "packages/thing/README.md": "# @nextlyhq/thing\n\nDoes a thing.\n",
    });
    const { findings } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
    });
    const skeleton = findings.filter(f => f.check === "readme-skeleton");
    expect(skeleton).toHaveLength(4);
    expect(skeleton.map(f => f.message).join(" ")).toContain("alpha or stability note");
    expect(skeleton.map(f => f.message).join(" ")).toContain("License section");
  });

  it("accepts the house synonyms rather than one spelling", async () => {
    // `Quickstart` and `See also` are what several packages already use. A check that
    // demanded a single heading would be a rename dressed up as a rule.
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md":
          "# t\n\nexperimental\n\n## Quickstart\n\n## See also\n\n## Licence\n",
      })
    ).not.toContain("readme-skeleton");
  });

  it("does not check a private package", async () => {
    expect(
      await checksFor({
        "packages/thing/package.json": pkg({ private: true }),
        "packages/thing/README.md": "# t\n",
      })
    ).not.toContain("readme-skeleton");
  });
});

describe("readme-skeleton reads only what npm renders", () => {
  const fenced = [
    "# @nextlyhq/thing",
    "",
    "Does a thing.",
    "",
    "Here is the shape every README should have:",
    "",
    "````md",
    "Nextly is in alpha.",
    "## Install",
    "## Related packages",
    "## License",
    "````",
    "",
  ].join("\n");

  it("does not accept sections that exist only inside a code fence", async () => {
    // Otherwise a README that merely SHOWS the skeleton passes as though it had one.
    const checks = await checksFor({
      "README.md": "# nextly\n\n@nextlyhq/thing\n",
      "packages/thing/package.json": pkg(),
      "packages/thing/README.md": fenced,
    });
    expect(checks).toContain("readme-skeleton");
  });

  it("does not accept sections that exist only inside an HTML comment", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md":
          "# t\n\n<!--\nNextly is in alpha.\n## Install\n## Related packages\n## License\n-->\n",
      })
    ).toContain("readme-skeleton");
  });

  it("accepts a Stability section carrying the state, not just the phrase", async () => {
    // `## Stability` / `Alpha.` is what blocks-engine used before this work, and it is
    // a correct statement. Demanding the literal words would be demanding boilerplate.
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md":
          "# t\n\n## Stability\n\nAlpha.\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).not.toContain("readme-skeleton");
  });

  it("strips fences and comments but keeps the surrounding prose", () => {
    const out = renderedProse("before\n\n```\n## Install\n```\n\n<!-- ## License -->\n\nafter\n");
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).not.toContain("## Install");
    expect(out).not.toContain("## License");
  });

  it("treats an unclosed fence as code through to the end of the file", () => {
    // Markdown does. Stopping at paired fences would leave the tail in prose, so a
    // truncated example could satisfy the sections this is looking for.
    const out = renderedProse("intro\n\n```md\nNextly is in alpha.\n## Install\n");
    expect(out).toContain("intro");
    expect(out).not.toContain("## Install");
    expect(out).not.toContain("in alpha");
  });

  it("does not accept sections that exist only inside an unclosed fence", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md":
          "# t\n\n```md\nNextly is in alpha.\n## Install\n## Related packages\n## License\n",
      })
    ).toContain("readme-skeleton");
  });

  it("rejects an empty Status section, which answers nothing", async () => {
    const checks = await checksFor({
      "README.md": "# nextly\n\n@nextlyhq/thing\n",
      "packages/thing/package.json": pkg(),
      "packages/thing/README.md":
        "# t\n\n## Status\n\n## Install\n\n## Related packages\n\n## License\n",
    });
    expect(checks).toContain("readme-skeleton");
  });

  it("accepts a Status section once it carries a value", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md":
          "# t\n\n## Status\n\nBeta.\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).not.toContain("readme-skeleton");
  });
});

describe("a fence marker inside a comment is not a fence", () => {
  it("does not let a commented-out fence swallow the rest of the file", () => {
    // Running the fence rules before comment removal made `<!--\n```\n-->` eat
    // everything after it, reporting real sections as missing on a correct README.
    const out = renderedProse("# t\n\n<!--\n```\n-->\n\n## Status\n\nAlpha.\n\n## License\n");
    expect(out).toContain("## Status");
    expect(out).toContain("## License");
  });

  it("passes a README whose comment contains a stray fence marker", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md":
          "# t\n\n<!--\n```\n-->\n\n## Status\n\nAlpha.\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).not.toContain("readme-skeleton");
  });

  it("still strips a real unclosed fence that is not inside a comment", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": pkg(),
        "packages/thing/README.md":
          "# t\n\n```md\n## Status\n\nAlpha.\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).toContain("readme-skeleton");
  });
});

describe("retired-category-keyword", () => {
  it("fires on the bare 'framework' keyword", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": JSON.stringify({
          name: "@nextlyhq/thing",
          keywords: ["cms", "framework"],
        }),
        "packages/thing/README.md": "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).toContain("retired-category-keyword");
  });

  it("fires on 'app-framework' and on the plural", async () => {
    for (const keyword of ["app-framework", "frameworks", "App-Frameworks"]) {
      expect(
        await checksFor({
          "README.md": "# nextly\n\n@nextlyhq/thing\n",
          "packages/thing/package.json": JSON.stringify({
            name: "@nextlyhq/thing",
            keywords: [keyword],
          }),
          "packages/thing/README.md":
            "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
        })
      ).toContain("retired-category-keyword");
    }
  });

  it("does not fire on keywords that merely contain the word", async () => {
    // `page-builder` and `nextly-plugin` are keywords this must never touch, and a substring
    // match would have taken anything hyphenated with the word along with it.
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": JSON.stringify({
          name: "@nextlyhq/thing",
          keywords: ["page-builder", "nextly-plugin", "framework-agnostic"],
        }),
        "packages/thing/README.md":
          "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).not.toContain("retired-category-keyword");
  });

  it("does not fire on a package with no keywords at all", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": JSON.stringify({ name: "@nextlyhq/thing" }),
        "packages/thing/README.md":
          "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).not.toContain("retired-category-keyword");
  });

  it("fires on the bare-string form npm also accepts", async () => {
    // `"keywords": "framework"` reaches the registry the same way the array does. Iterating
    // the string yields single characters, none of which is a whole tag, so the check went
    // green on the one manifest shape it exists to catch.
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": '{"name":"@nextlyhq/thing","keywords":"framework"}',
        "packages/thing/README.md":
          "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).toContain("retired-category-keyword");
  });

  it("does not fire on a bare-string keyword that is not the category", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": '{"name":"@nextlyhq/thing","keywords":"page-builder"}',
        "packages/thing/README.md":
          "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).not.toContain("retired-category-keyword");
  });
});

describe("one classifier owns keywords", () => {
  const manifest = keyword =>
    ({
      "README.md": "# nextly\n\n@nextlyhq/thing\n",
      "packages/thing/package.json": JSON.stringify({
        name: "@nextlyhq/thing",
        keywords: [keyword],
      }),
      "packages/thing/README.md":
        "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
    });

  it("reports a keyword once, not once per overlapping check", async () => {
    // `app-framework` matched the whole-tag pattern AND the prose pattern, so the same
    // manifest was reported under two check names by two classifiers free to drift apart.
    const checks = await checksFor(manifest("app-framework"));
    expect(checks.filter(c => c === "retired-category-keyword")).toHaveLength(1);
    expect(checks).not.toContain("retired-category");
  });

  it("still catches the category embedded in a longer keyword", async () => {
    // The whole-tag pattern alone cannot see this one, which is why the classifier asks
    // both questions rather than the prose check being deleted outright.
    expect(await checksFor(manifest("nextjs-app-framework"))).toContain(
      "retired-category-keyword"
    );
  });

  it("still reports a description that names the category", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": JSON.stringify({
          name: "@nextlyhq/thing",
          description: "The app framework for Next.js.",
        }),
        "packages/thing/README.md":
          "# t\n\nin alpha\n\n## Install\n\n## Related packages\n\n## License\n",
      })
    ).toContain("retired-category");
  });
});

describe("namesRetiredCategory", () => {
  it("answers for a whole tag and for the phrase inside one", () => {
    for (const tag of ["framework", "frameworks", "app-framework", "nextjs-app-framework"]) {
      expect(namesRetiredCategory(tag)).toBe(true);
    }
  });

  it("leaves tags that merely contain the word alone", () => {
    for (const tag of ["framework-agnostic", "page-builder", "nextly-plugin"]) {
      expect(namesRetiredCategory(tag)).toBe(false);
    }
  });

  it("is false for anything that is not a string", () => {
    expect(namesRetiredCategory(undefined)).toBe(false);
    expect(namesRetiredCategory(7)).toBe(false);
  });
});

describe("packageKeywords", () => {
  it("reads both manifest shapes as the same list", () => {
    expect(packageKeywords({ keywords: ["cms", "framework"] })).toEqual(["cms", "framework"]);
    expect(packageKeywords({ keywords: "framework" })).toEqual(["framework"]);
  });

  it("returns nothing for a manifest with no usable keywords", () => {
    expect(packageKeywords({})).toEqual([]);
    expect(packageKeywords(undefined)).toEqual([]);
    expect(packageKeywords({ keywords: null })).toEqual([]);
    expect(packageKeywords({ keywords: 7 })).toEqual([]);
  });

  it("drops non-string entries rather than passing them to a regex", () => {
    expect(packageKeywords({ keywords: ["cms", null, 7, "framework"] })).toEqual([
      "cms",
      "framework",
    ]);
  });
});
