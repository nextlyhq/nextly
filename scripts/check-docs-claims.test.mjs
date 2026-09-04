import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { runChecks } from "./check-docs-claims.mjs";

/**
 * Each fixture exhibits exactly one defect, and every check is asserted twice:
 * once on a tree that has the defect, once on the nearest tree that does not.
 * A check that only ever passes has not been shown to work, and the negative
 * case is what distinguishes "the check fired" from "the check fires on
 * anything".
 */
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "docs-claims-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return root;
}

const pkg = (extra = {}) =>
  JSON.stringify({ name: "@nextlyhq/thing", version: "0.0.2-alpha.62", ...extra });

async function checksFor(files) {
  const root = await fixture(files);
  const { findings } = await runChecks({ repoRoot: root, resolveRef: () => true });
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
    const root = await fixture({ "docs/a.mdx": "returns a coming soon placeholder\n" });
    const { findings } = await runChecks({
      repoRoot: root,
      resolveRef: () => true,
      allowlist: { "forbidden-status-phrase": { "docs/a.mdx": "accurate here" } },
    });
    expect(findings.map(f => f.check)).not.toContain("forbidden-status-phrase");
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
    const root = await fixture({
      "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/dev/x.ts\n",
    });
    const { findings } = await runChecks({
      repoRoot: root,
      resolveRef: ref => ref === "main",
    });
    expect(findings.map(f => f.check)).toContain("dead-branch-link");
  });

  it("does not fire for a ref that resolves", async () => {
    const root = await fixture({
      "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/main/x.ts\n",
    });
    const { findings } = await runChecks({
      repoRoot: root,
      resolveRef: ref => ref === "main",
    });
    expect(findings.map(f => f.check)).not.toContain("dead-branch-link");
  });

  it("reports unverifiable rather than failing when refs cannot be resolved", async () => {
    const root = await fixture({
      "docs/a.mdx": "https://github.com/nextlyhq/nextly/blob/dev/x.ts\n",
    });
    const { findings, unverifiable } = await runChecks({
      repoRoot: root,
      resolveRef: () => null,
    });
    expect(findings.map(f => f.check)).not.toContain("dead-branch-link");
    expect(unverifiable.length).toBeGreaterThan(0);
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
