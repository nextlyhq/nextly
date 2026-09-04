import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { digestLine, runChecks, splitRefAndPath } from "./check-docs-claims.mjs";

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
