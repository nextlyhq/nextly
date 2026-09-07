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

/** The full findings, for the few assertions that are about more than the check name. */
async function findingsFor(spec, opts = {}) {
  const { root, files } = await fixture(spec);
  const { findings } = await runChecks({
    repoRoot: root,
    files,
    remoteRefs: REFS,
    hasLocalCommit: () => true,
    ...opts,
  });
  return findings;
}

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

  it("spends the exemption, so a second copy of the line is still reported", async () => {
    // `count` is the budget, not a label. One entry excusing every duplicate of its line
    // means a second copy can be added anywhere in the same file and inherit permission
    // granted to the first.
    const exempt = "returns a coming soon placeholder";
    const { root, files } = await fixture({ "docs/a.mdx": `${exempt}\n${exempt}\n` });
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
    const phrase = findings.filter(f => f.check === "forbidden-status-phrase");
    expect(phrase).toHaveLength(1);
    expect(phrase[0].line).toBe(2);
    // Said once, naming the budget, rather than repeated beside every surplus occurrence.
    expect(findings.filter(f => f.check === "allowlist-count-exceeded")).toHaveLength(1);
  });

  it("excuses as many occurrences as the count declares", async () => {
    // The positive control for the budget. Without it a helper that spent every exemption
    // immediately would pass the test above just as well.
    const exempt = "returns a coming soon placeholder";
    const { root, files } = await fixture({ "docs/a.mdx": `${exempt}\n${exempt}\n` });
    const { findings } = await runChecks({
      repoRoot: root,
      files,
      remoteRefs: REFS,
      hasLocalCommit: () => true,
      allowlist: {
        "forbidden-status-phrase": {
          "docs/a.mdx": { count: 2, digests: [digestLine(exempt)] },
        },
      },
    });
    expect(findings.map(f => f.check)).not.toContain("forbidden-status-phrase");
    expect(findings.map(f => f.check)).not.toContain("allowlist-count-exceeded");
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

  it("fires on a comma-separated keyword string, which npm splits", async () => {
    // The bare-string fix read `"cms, framework"` as one value, which matches no whole tag,
    // so the published `framework` keyword still produced nothing.
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "packages/thing/package.json": '{"name":"@nextlyhq/thing","keywords":"cms, framework"}',
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

describe("documented-key-prefix", () => {
  const SOURCE = "packages/nextly/src/domains/auth/services/api-key-service.ts";
  const tree = (docs, declaration = 'const KEY_PREFIX = "nx_live_";') => ({
    "README.md": "# nextly\n\n@nextlyhq/thing\n",
    [SOURCE]: `${declaration}\nexport function make() { return KEY_PREFIX; }\n`,
    ...docs,
  });

  it("fires on a bearer example using another vendor's prefix", async () => {
    // `sk_` is Stripe's prefix, so a Nextly page documenting it sends a reader
    // a header that cannot authenticate against this service.
    expect(
      await checksFor(tree({ "docs/guides/authentication.mdx": "Use `Authorization: Bearer sk_...`\n" }))
    ).toContain("documented-key-prefix");
  });

  it("accepts the prefix the source declares", async () => {
    expect(
      await checksFor(tree({ "docs/guides/authentication.mdx": "Use `Authorization: Bearer nx_live_...`\n" }))
    ).not.toContain("documented-key-prefix");
  });

  it("reads the prefix from source rather than assuming it", async () => {
    // Change the declaration and the same docs page becomes wrong. Without this
    // the check could be passing on a hardcoded copy of the prefix.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use `Authorization: Bearer nx_live_...`\n" },
          'const KEY_PREFIX = "nx_prod_";'
        )
      )
    ).toContain("documented-key-prefix");
  });

  it("leaves placeholders alone", async () => {
    // `Bearer <key>` is something a reader substitutes, not a format claim.
    expect(
      await checksFor(
        tree({ "docs/api-reference/rest-api.mdx": "Send `Authorization: Bearer <key>` or `Bearer <token>`.\n" })
      )
    ).not.toContain("documented-key-prefix");
  });

  it("refuses when the declaration cannot be found, rather than passing", async () => {
    // Renaming or moving the constant must not silently leave the docs unchecked.
    const checks = await checksFor(
      tree(
        { "docs/guides/authentication.mdx": "Use `Authorization: Bearer sk_...`\n" },
        'const SOMETHING_ELSE = "nx_live_";'
      )
    );
    expect(checks).toContain("key-prefix-undeclared");
    expect(checks).not.toContain("documented-key-prefix");
  });

  it("is not fooled by a longer name that ends in the same word", async () => {
    // `OTHER_KEY_PREFIX` is a different constant. The word boundary is what keeps
    // it out, and without this test a looser pattern would read it as a second
    // declaration and refuse on a perfectly good file.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use `Authorization: Bearer nx_live_...`\n" },
          'const OTHER_KEY_PREFIX = "sk_";\nconst KEY_PREFIX = "nx_live_";'
        )
      )
    ).not.toContain("key-prefix-undeclared");
  });

  it("ignores a commented-out declaration left behind after a rename", async () => {
    // A stale `// const KEY_PREFIX = "nx_live_"` kept for context is not a
    // declaration, and counting it as one is how the docs get held to a value
    // the service no longer issues while the check reports clean. The live
    // constant here has a different name, so the commented line is the only
    // text matching the old one.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          '// const KEY_PREFIX = "nx_live_";\nconst API_KEY_PREFIX = "nx_v2_";',
        ),
      ),
    ).toContain("key-prefix-undeclared");
  });

  it("refuses when two real declarations disagree", async () => {
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          'const KEY_PREFIX = "nx_live_";\nconst KEY_PREFIX = "sk_";',
        ),
      ),
    ).toContain("key-prefix-undeclared");
  });

  it("accepts an exported declaration", async () => {
    // Anchoring must not become so tight that the ordinary form stops matching.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          'export const KEY_PREFIX = "nx_live_";',
        ),
      ),
    ).not.toContain("key-prefix-undeclared");
  });

  it("refuses when the declaring file is not tracked at all", async () => {
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        "docs/guides/authentication.mdx": "Use `Authorization: Bearer sk_...`\n",
      })
    ).toContain("key-prefix-source-missing");
  });

  it("reports another service's token unless a line is exempted", async () => {
    // Ownership cannot be read off a credential. A Stripe-shaped token in the
    // Nextly auth guide is a regression, not a Stripe example, so the shape of
    // the token decides nothing and only an exempted line is excused. The tree
    // holds other valid examples, so the examined count stays above zero and
    // the finding is what distinguishes this from a clean pass.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "Use Authorization: Bearer sk_test_EXAMPLE\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("matches the scheme whatever its casing", async () => {
    // RFC 7235 makes the scheme case-insensitive, so `bearer` names the same
    // header as `Bearer` and its credential is compared like any other. A
    // scheme that reached no comparison would leave a wrong prefix unreported
    // while the rest of the tree kept the examined count above zero.
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      expect(
        await checksFor(
          tree({
            "docs/guides/authentication.mdx":
              "Use Authorization: " + scheme + " sk_EXAMPLE\n",
          }),
        ),
      ).toContain("documented-key-prefix");
    }
  });

  it("reports a credential whose case does not match what is issued", async () => {
    // The scheme is case-insensitive and the credential is not, and conflating
    // them would excuse a real defect. A key is authenticated by sha256 of the
    // whole string, so NX_LIVE_ hashes to something else and can never match a
    // stored key. Documentation showing it teaches a header that cannot work.
    for (const token of ["NX_LIVE_EXAMPLE", "Nx_Live_EXAMPLE"]) {
      expect(
        await checksFor(
          tree({
            "docs/guides/authentication.mdx": "Use Authorization: Bearer " + token + "\n",
          }),
        ),
      ).toContain("documented-key-prefix");
    }
  });

  it("covers prose outside docs/, such as ARCHITECTURE.md", async () => {
    // The scope is every prose surface rather than one directory.
    // ARCHITECTURE.md publishes a bearer example too, and a scope named after
    // `docs/` would leave it unguarded.
    expect(
      await checksFor(
        tree({ "ARCHITECTURE.md": "API keys: Authorization: Bearer sk_live_EXAMPLE\n" }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("finds an example wrapped after the scheme", async () => {
    // Markdown renders the break as whitespace, so this is one example to a
    // reader. A line-by-line match sees two halves and judges neither, and the
    // wrong prefix goes out in a page that reads exactly like the correct one.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Send Authorization: Bearer\nsk_wrapped_EXAMPLE now\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("ignores a wrong prefix nobody can see", async () => {
    // An HTML or MDX comment is not published. Reporting it blocks a merge over
    // text that reaches no reader and no generated file.
    for (const comment of [
      "<!-- Old: Authorization: Bearer sk_dead_EXAMPLE -->",
      "{/* Old: Authorization: Bearer sk_dead_EXAMPLE */}",
    ]) {
      const checks = await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            comment + "\nUse Authorization: Bearer nx_live_EXAMPLE\n",
        }),
      );
      expect(checks).not.toContain("documented-key-prefix");
      expect(checks).not.toContain("key-prefix-unexamined");
    }
  });

  it("reports the real line number even after a comment above it", async () => {
    // Comments are blanked rather than removed, so offsets still name the line
    // a reader would open.
    const findings = await findingsFor(
      tree({
        "docs/guides/authentication.mdx":
          "<!-- a\nmultiline\ncomment -->\nUse Authorization: Bearer sk_EXAMPLE\n",
      }),
    );
    const hit = findings.find(f => f.check === "documented-key-prefix");
    expect(hit.line).toBe(4);
  });

  it("refuses when the only remaining example is exempted", async () => {
    // The population must count what was JUDGED. A tree whose last example is
    // allowlisted has checked no Nextly key at all, so it owes a refusal rather
    // than the silence of a finding it did not look for.
    const example = "Bearer partner_EXAMPLE";
    expect(
      await checksFor(
        tree({ "docs/guides/integrations.mdx": `Use Authorization: ${example}\n` }),
        {
          allowlist: {
            "documented-key-prefix": {
              "docs/guides/integrations.mdx": { count: 1, digests: [digestLine(example)] },
            },
          },
        },
      ),
    ).toContain("key-prefix-unexamined");
  });

  it("does not let a wrapped exemption cover a credential it never saw", async () => {
    // The exemption is digested from the whole example, not from the line the
    // match starts on. A third-party example that wraps after `Bearer` puts its
    // credential on the next line, so a line digest would name the scheme and
    // leave the credential free to change underneath it: swapping in a wrong
    // Nextly prefix would inherit the exemption while other pages held the
    // examined count above zero and CI stayed green.
    const wrapped = "Bearer\npartner_EXAMPLE";
    const allowlist = {
      "documented-key-prefix": {
        "docs/guides/integrations.mdx": { count: 1, digests: [digestLine(wrapped)] },
      },
    };
    // The example the allowlist was written for is excused.
    expect(
      await checksFor(
        tree({ "docs/guides/integrations.mdx": `Use Authorization: ${wrapped}\n` }),
        { allowlist },
      ),
    ).not.toContain("documented-key-prefix");
    // The same first line with a different credential is not.
    expect(
      await checksFor(
        tree({ "docs/guides/integrations.mdx": "Use Authorization: Bearer\nsk_EXAMPLE\n" }),
        { allowlist },
      ),
    ).toContain("documented-key-prefix");
  });

  it("ignores a declaration inside a block comment", async () => {
    // The anchor stops a `//`-commented copy standing in for the real thing,
    // and a block comment does not indent what it contains, so a stale
    // `const KEY_PREFIX` on its own line inside one matches the same anchor.
    // Where issuance has moved to a differently named constant, that stale copy
    // is the only match, and the docs are then held to a value nothing issues.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          '/*\nconst KEY_PREFIX = "nx_live_";\n*/\nconst API_KEY_PREFIX = "nx_v2_";',
        ),
      ),
    ).toContain("key-prefix-undeclared");
  });

  it("keeps a declaration whose line holds a string containing a slash pair", async () => {
    // Blanking comments must track string literals: a `//` inside one begins no
    // comment, and blanking from it would swallow the rest of the line and the
    // declaration with it.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          'const DOCS = "https://nextlyhq.com";\nconst KEY_PREFIX = "nx_live_";',
        ),
      ),
    ).not.toContain("key-prefix-undeclared");
  });

  it("leaves a symbolic placeholder alone", async () => {
    // `YOUR_API_KEY` instructs a reader to substitute something; it is not a
    // claim about the format. Reporting it would have the always-run docs job
    // block a correct page. Nothing was judged here, so the refusal is what is
    // owed instead.
    const checks = await checksFor(
      tree({ "docs/guides/authentication.mdx": "Use Authorization: Bearer YOUR_API_KEY\n" }),
    );
    expect(checks).not.toContain("documented-key-prefix");
    expect(checks).toContain("key-prefix-unexamined");
  });

  it("still reports a capitalised spelling of the issued prefix", async () => {
    // The placeholder rule reads capitals as "replace me", and this is the one
    // all-capitals token it must not excuse: `NX_LIVE_` spells the prefix the
    // service issues, so it is a mis-cased key rather than an instruction, and
    // sha256 of the whole string means that header cannot authenticate.
    expect(
      await checksFor(
        tree({ "docs/guides/authentication.mdx": "Use Authorization: Bearer NX_LIVE_KEY\n" }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("reads a TypeScript file by its comments, not by its code", async () => {
    // What a reader is shown of a `.ts` file is its JSDoc. An email provider that builds
    // `Authorization: "Bearer vendor_key"` at runtime is doing its job, not documenting a
    // Nextly key, and judging it would block an always-run job over a correct integration.
    const checks = await checksFor(
      tree({
        "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
        "packages/nextly/src/domains/email/provider.ts":
          'const headers = { Authorization: "Bearer vendor_key_LIVE" };\n',
      }),
    );
    expect(checks).not.toContain("documented-key-prefix");
  });

  it("does not join a bearer at a paragraph end to the next paragraph", async () => {
    // A single line break renders as a space, so a wrapped example is one example. A blank
    // line is a boundary, and reading across it invents a header nobody wrote.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "Supported scheme: Bearer\n\nsk_test_EXAMPLE is Stripe's test key\n" +
            "and here is ours: Authorization: Bearer nx_live_EXAMPLE\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("judges comment syntax a fence makes visible", async () => {
    // Inside a fenced sample the braces and slashes are printed verbatim, so this is an
    // example a reader copies. Blanking it hides a wrong prefix while every other example
    // keeps the population above zero.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "```tsx\n{/* Authorization: Bearer sk_live_EXAMPLE */}\n```\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("still ignores a comment the reader never sees", async () => {
    // The other side of the same rule, outside any fence. Without this the fence change
    // would read as "blank nothing" and pass just as well.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "<!-- Authorization: Bearer sk_live_EXAMPLE -->\nUse Authorization: Bearer nx_live_EXAMPLE\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("checks a key format documented without the scheme, where it is declared", async () => {
    // The declaring file states the format three times and none of them carry `Bearer`. A
    // scheme-only scan lets those advertise a retired prefix while one updated bearer
    // example keeps the population guard satisfied.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          '/** Key format: `nx_old_<base64url-32-bytes>` */\nconst KEY_PREFIX = "nx_live_";',
        ),
      ),
    ).toContain("documented-key-prefix");
  });

  it("judges a key written out in full where it is declared", async () => {
    // The declaring file shows the display prefix a masked UI renders, `"nx_live_abcdefgh"`,
    // which trails off nowhere and so is invisible to the placeholder form. It goes stale
    // exactly as a header example does.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          '/** Display prefix: first 16 chars ("sk_live_abcdefgh") for the masked key. */\nconst KEY_PREFIX = "nx_live_";',
        ),
      ),
    ).toContain("documented-key-prefix");
  });

  it("accepts the concrete example when it matches what is issued", async () => {
    // The positive control. Without it a rule reporting every concrete token would pass the
    // case above just as well.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          '/** Display prefix: first 16 chars ("nx_live_abcdefgh") for the masked key. */\nconst KEY_PREFIX = "nx_live_";',
        ),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("judges the prefix quoted on its own, with nothing after it", async () => {
    // The declaring file explains what the prefix is for and names it bare. Nothing trails it,
    // so the placeholder form never saw it, and it goes stale like any other statement.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          '/** Keys carry the `sk_live_` prefix for identification in logs. */\nconst KEY_PREFIX = "nx_live_";',
        ),
      ),
    ).toContain("documented-key-prefix");
  });

  it("judges an alphabetic credential when the header is spelled out", async () => {
    // `Authorization: Bearer abcdef` is a line a reader copies and it cannot authenticate,
    // whatever its shape. Naming the header is what separates it from prose about the scheme,
    // so no guess from punctuation is needed.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Send `Authorization: Bearer abcdef` with each call.\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("still leaves prose about the scheme alone", async () => {
    // The other side of that, or naming the header would read as "report every word".
    const checks = await checksFor(
      tree({
        "docs/guides/authentication.mdx":
          "Send a Bearer token. A Bearer header was present.\nUse Authorization: Bearer nx_live_EXAMPLE\n",
      }),
    );
    expect(checks).not.toContain("documented-key-prefix");
  });

  it("reads a heading as the introduction to the fence below it", async () => {
    // A fence holds no blank line, so it is a paragraph of its own, and the heading that
    // announces what it contains is a different one. Judged alone the fence says nothing about
    // keys and the stale format inside it goes unexamined.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "## API key format\n\n```\nsk_live_<random>...\n```\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("does not carry that introduction further than one block", async () => {
    // The window is the block before, not the whole page: a page that mentions keys once
    // would otherwise put every fenced identifier in it under suspicion.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "Use Authorization: Bearer nx_live_EXAMPLE\n\nSome unrelated prose here.\n\n```\nidx_comp_<slug>_parent\n```\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("does not read a database identifier elsewhere as a concrete key", async () => {
    // The reason the concrete form is confined to the declaring file. A comment saying
    // "primary key" satisfies the vocabulary as readily as one about credentials, and across
    // the tree that shape reports twenty-two column, table and index names against one real
    // example.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/schema/columns.ts":
            '/** The primary key column is named `"single_pricings_pkey"` by the dialect. */\nexport const x = 1;\n',
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("does not read a snake_case identifier elsewhere as a key format", async () => {
    // `idx_comp_<slug>_parent` is an index name, and nothing in the shape of a token says it
    // is a credential. Outside the declaring file only the header form is read, which
    // carries no such ambiguity.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/api/field-groups.ts":
            "/** The index is named `idx_comp_<slug>_parent`. */\nexport const x = 1;\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("checks bearer examples published in TypeScript documentation", async () => {
    // `shared/types/config.ts` documents the header in JSDoc that ships in the
    // package's declarations, so it is an example a reader is shown in their
    // editor. A Markdown-only scope lets it go stale while every published page
    // is updated and the check passes.
    expect(
      await checksFor(
        tree({
          "packages/nextly/src/shared/types/config.ts":
            "/** Authenticate with `Authorization: Bearer sk_live_EXAMPLE`. */\nexport type C = {};\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("does not judge a note to whoever maintains the code", async () => {
    // A line comment is not published. An integration explaining which header a
    // vendor wants is documenting that vendor, and an always-run job cannot
    // block a correct one over it.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/domains/email/provider.ts":
            "// The vendor requires Authorization: Bearer vendor_key_LIVE\nexport const x = 1;\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("does not judge an ordinary block comment either", async () => {
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/domains/email/provider.ts":
            "/* Vendor wants Authorization: Bearer vendor_key_LIVE */\nexport const x = 1;\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("is not derailed by an apostrophe in JSX text", async () => {
    // An apostrophe is not a string delimiter here, and a quoted string cannot hold a raw
    // newline, so the scan ends at the line. Running on would blank every doc comment until
    // the next apostrophe in the file, and the bearer examples in them would never be judged
    // while other files held the examined count above zero. Thirty files in this repository
    // open such a span, the longest running 195 lines.
    expect(
      await checksFor(
        tree({
          "packages/nextly/src/admin/Panel.tsx":
            "export const P = () => <p>don't</p>;\n" +
            "/** Authenticate with `Authorization: Bearer sk_live_EXAMPLE`. */\n" +
            "export const Q = () => <p>won't</p>;\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("still reads a template literal across lines", async () => {
    // The exception the rule needs, asserted on content INSIDE the literal, which is the
    // only place the difference shows. A codegen module holding a sample is all code, so
    // nothing in it is documentation this site publishes. Ending the literal at the first
    // newline turns the rest of the sample back into ordinary source, and the comment in it
    // is then read as a claim the package makes about its own keys.
    const backtick = String.fromCharCode(96);
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/cli/templates.ts":
            `const sample = ${backtick}\n/** Authorization: Bearer sk_live_EXAMPLE */\n${backtick};\n`,
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("judges a concrete credential that carries no underscore", async () => {
    // Requiring an underscore missed these. Both are headers a reader would copy and neither
    // can authenticate, so the shape of the separator decides nothing.
    for (const token of ["sk-live-EXAMPLE", "abc123"]) {
      expect(
        await checksFor(
          tree({
            "docs/guides/authentication.mdx": `Use Authorization: Bearer ${token}\n`,
          }),
        ),
      ).toContain("documented-key-prefix");
    }
  });

  it("leaves prose about the scheme alone", async () => {
    // The other side of matching any word after `Bearer`. "send a Bearer token" is a sentence
    // about the header, and reporting it would block correct pages on a job that always runs.
    const checks = await checksFor(
      tree({
        "docs/guides/authentication.mdx":
          "Send a Bearer token. A Bearer header was present.\nUse Authorization: Bearer nx_live_EXAMPLE\n",
      }),
    );
    expect(checks).not.toContain("documented-key-prefix");
  });

  it("does not judge a JavaScript test file", async () => {
    // `proseFiles` includes package `.mjs`, and the test predicate named only TypeScript
    // extensions, so a `.test.mjs` doc comment was read as Nextly documentation. Nine package
    // test files in this repository are named that way.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/domains/email/provider.test.mjs":
            "/** Authenticate with `Authorization: Bearer vendor_bad_KEY`. */\nexport const x = 1;\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("does not judge a package npm never receives", async () => {
    // Build machinery reaches no consumer, so a comment in it documents nothing.
    expect(
      await checksFor({
        "README.md": "# nextly\n\n@nextlyhq/thing\n",
        [SOURCE]: 'const KEY_PREFIX = "nx_live_";\n',
        "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
        "packages/tsconfig/package.json": JSON.stringify({
          name: "@nextlyhq/tsconfig",
          private: true,
        }),
        "packages/tsconfig/src/index.ts":
          "/** Authenticate with `Authorization: Bearer vendor_bad_KEY`. */\nexport const x = 1;\n",
      }),
    ).not.toContain("documented-key-prefix");
  });

  it("judges comment syntax an inline code span makes visible", async () => {
    // A span prints its contents as typed, so this is an example a reader copies, exactly as
    // a fenced one is.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "Write `{/* Authorization: Bearer sk_bad_EXAMPLE */}` in the layout.\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("reports a stale example when the prefix is SHORTENED", async () => {
    // `startsWith` passes anything the declared value is a prefix of, so shortening
    // `nx_live_` to `nx_` left every stale example in the tree satisfying it and the check
    // reporting clean while nothing issued that format any more.
    expect(
      await checksFor(
        tree(
          { "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n" },
          'const KEY_PREFIX = "nx_";',
        ),
      ),
    ).toContain("documented-key-prefix");
  });

  it("judges a bare key format in any doc comment talking about keys", async () => {
    // `direct-api/types/rbac.ts` publishes three of these with no scheme, in JSDoc that ships
    // in the package's declarations, so scoping to the declaring file left editor-visible
    // examples free to go stale.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/direct-api/types/rbac.ts":
            '/** The full raw key value (e.g., `"sk_live_<random>..."`). */\nexport type K = string;\n',
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("does not read an index name as a key format", async () => {
    // The sentence decides, because the shape cannot: `idx_comp_<slug>_parent` in
    // `api/field-groups.ts` is a database identifier, and its comment never says key.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "packages/nextly/src/api/field-groups.ts":
            "/** The index is named `idx_comp_<slug>_parent`, which bounds the slug length. */\nexport const x = 1;\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("keeps a doc comment that follows a regex literal", async () => {
    // `/[/*]/` holds a slash-star, and reading it as a comment ate through the doc comment
    // below it. That drops a published example and the check then reports clean, so this
    // direction is a false pass rather than the refusal the declaration read would give.
    expect(
      await checksFor(
        tree({
          "packages/nextly/src/api/parse.ts":
            "const SLASHES = /[/*]/;\n" +
            "/** Authenticate with `Authorization: Bearer sk_live_EXAMPLE`. */\n" +
            "export const P = SLASHES;\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("still reads a division sign as division", async () => {
    // The other side. Treating `a / b` as a regex start would run to the next slash and
    // swallow whatever is between, so the previous token has to decide.
    expect(
      await checksFor(
        tree({
          "packages/nextly/src/api/rate.ts":
            "const half = total / 2;\n" +
            "/** Authenticate with `Authorization: Bearer sk_live_EXAMPLE`. */\n" +
            "export const R = half;\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("does not excuse a retired prefix spelled in capitals", async () => {
    // Reading every uppercase token as a placeholder waves through any prefix that is no
    // longer issued, and the docs then teach a header that cannot authenticate.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer SK_LIVE_EXAMPLE\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("does not judge a changeset quoting the claim it corrects", async () => {
    // A changeset says what is being fixed, so it repeats the wrong example by design. The
    // per-line checks already skip them for this reason.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          ".changeset/brave-otters-shout.md":
            "---\n'@nextlyhq/thing': patch\n---\n\nReplace `Authorization: Bearer sk_old_EXAMPLE` in the auth guide.\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("does not read an index name in Markdown as a key format", async () => {
    // The context test applies to both surfaces. A page explaining a generated index name is
    // not documenting a credential, and only the surrounding sentence can say so.
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
          "docs/reference/field-groups.mdx":
            "## Index names\n\nThe generated index is `idx_comp_<slug>_parent`, which bounds the slug length.\n",
        }),
      ),
    ).not.toContain("documented-key-prefix");
  });

  it("still judges a bare key format in Markdown that talks about keys", async () => {
    // The positive control for that gate, or it would read as "never scan Markdown".
    expect(
      await checksFor(
        tree({
          "docs/guides/authentication.mdx":
            "## Key format\n\nEvery API key looks like `sk_live_<random>...` when issued.\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("judges a doc comment, which is the form that gets published", async () => {
    // The other side of the same rule. Without it, restricting the scan to
    // JSDoc would read as "scan nothing" and pass just as well.
    expect(
      await checksFor(
        tree({
          "packages/nextly/src/shared/types/config.ts":
            "/** Authenticate with `Authorization: Bearer sk_live_EXAMPLE`. */\nexport type C = {};\n",
        }),
      ),
    ).toContain("documented-key-prefix");
  });

  it("does not judge bearer headers in tests, which belong to other services", async () => {
    // Fixtures authenticate against Resend, Stripe and stub receivers. Holding
    // those to the Nextly prefix reports a defect that is not one, and a job
    // that always runs cannot afford it.
    const checks = await checksFor(
      tree({
        "docs/guides/authentication.mdx": "Use Authorization: Bearer nx_live_EXAMPLE\n",
        "packages/nextly/src/domains/email/__tests__/resend.test.ts":
          'const headers = { Authorization: "Bearer re_test_key" };\n',
        "packages/nextly/src/utils/validate-url.test.ts":
          'const headers = { authorization: "Bearer sk_test_key" };\n',
      }),
    );
    expect(checks).not.toContain("documented-key-prefix");
  });

  it("refuses when it examined no example at all", async () => {
    // The population assertion. Without it a docs tree that moved, was renamed,
    // or stopped using this syntax leaves the loop with nothing to judge and the
    // check reports clean having looked at nothing.
    expect(await checksFor(tree({}))).toContain("key-prefix-unexamined");
  });

  it("does not refuse once a real example is present", async () => {
    expect(
      await checksFor(tree({ "docs/guides/authentication.mdx": "Use `Authorization: Bearer nx_live_...`\n" }))
    ).not.toContain("key-prefix-unexamined");
  });

  it("only reads docs, not every tracked file", async () => {
    // A changelog or a test fixture quoting an old key is not a documentation claim.
    expect(
      await checksFor(
        tree({
          "CHANGELOG.md": "fixed `Authorization: Bearer sk_...` handling\n",
          "docs/guides/authentication.mdx": "Use `Authorization: Bearer nx_live_...`\n",
        })
      )
    ).not.toContain("documented-key-prefix");
  });
});

describe("packageKeywords", () => {
  it("reads both manifest shapes as the same list", () => {
    expect(packageKeywords({ keywords: ["cms", "framework"] })).toEqual(["cms", "framework"]);
    expect(packageKeywords({ keywords: "framework" })).toEqual(["framework"]);
  });

  it("splits a comma-separated string the way npm does", () => {
    // npm's own normalize-package-data splits on /,\s+/, so this is what the registry
    // publishes and therefore what the guard has to read.
    expect(packageKeywords({ keywords: "cms, framework" })).toEqual(["cms", "framework"]);
    expect(packageKeywords({ keywords: "cms,  app-framework,  nextjs" })).toEqual([
      "cms",
      "app-framework",
      "nextjs",
    ]);
  });

  it("keeps npm's quirk: a comma with no space does not split", () => {
    // Verified against normalize-package-data 8.0.0. Splitting here too would evaluate
    // keywords the registry never derives, which is a different check from the one intended.
    expect(packageKeywords({ keywords: "cms,framework" })).toEqual(["cms,framework"]);
  });

  it("drops empty entries, as npm does", () => {
    expect(packageKeywords({ keywords: ["cms", "", "framework"] })).toEqual(["cms", "framework"]);
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
