/**
 * The workspace compiles with one TypeScript.
 *
 * Every workspace package that depends on `typescript` must resolve the same
 * version, and so must every installed package that depends on it, except the
 * tools named below, which carry a copy of their own. A second version is not
 * a harmless duplicate: type-checking, declaration emit and the editor would
 * each answer with whichever compiler their package reached, and two compilers
 * disagree about the same source.
 *
 * Read from `pnpm-lock.yaml`'s dependency edges, not from its text: each
 * importer's resolved `typescript`, and each installed package's. A copy is
 * reported with the package that pulled it in, which is what has to change.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadAll } from "js-yaml";
import { describe, expect, it } from "vitest";

const LOCKFILE = fileURLToPath(new URL("../pnpm-lock.yaml", import.meta.url));

/** The one version the workspace compiles with. */
export const WORKSPACE_TYPESCRIPT = "7.0.2";

/**
 * Tools that install a TypeScript of their own, which no workspace code
 * compiles with. Named by package, with the version it brings: updating the
 * tool alone passes, and a new TypeScript from it is a change to review like
 * any other.
 */
export const TOOL_PRIVATE_TYPESCRIPT = new Map([
  [
    "@arethetypeswrong/core",
    {
      version: "5.6.1-rc",
      reason:
        "attw's analysis engine, pinned by attw; reached through `@arethetypeswrong/cli` and tsdown's `attw` option, and used only to read our packed declarations",
    },
  ],
]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];

/** The `typescript` entries of one importer or snapshot, across its dependency fields. */
function typescriptEntries(record) {
  return DEPENDENCY_FIELDS.map(field => record?.[field]?.typescript).filter(
    Boolean
  );
}

/** One document's workspace packages that resolve `typescript`. */
function importerEdges(document) {
  return Object.entries(document?.importers ?? {}).flatMap(([path, importer]) =>
    typescriptEntries(importer).map(resolved => ({
      holder: path,
      kind: "importer",
      version: String(resolved.version),
    }))
  );
}

/** One document's installed packages that depend on `typescript`. */
function packageEdges(document) {
  return Object.entries(document?.snapshots ?? {}).flatMap(([key, snapshot]) =>
    typescriptEntries(snapshot).map(version => ({
      holder: packageKey(key),
      kind: "package",
      version: String(version),
    }))
  );
}

/** The `typescript` versions one document installs. */
function installedVersions(document) {
  return Object.keys(document?.packages ?? {})
    .filter(key => key.startsWith("typescript@"))
    .map(key => key.slice("typescript@".length));
}

/**
 * Every `typescript` the lockfile resolves, each with what pulled it in.
 * pnpm writes more than one document to the file, and each is read.
 *
 * @returns {{ importers: number, edges: { holder: string, kind: "importer" | "package", version: string }[], installed: string[] }}
 */
export function typescriptEdges(lockfileText) {
  const documents = loadAll(lockfileText);
  return {
    importers: documents.reduce(
      (count, document) =>
        count + Object.keys(document?.importers ?? {}).length,
      0
    ),
    edges: documents.flatMap(document => [
      ...importerEdges(document),
      ...packageEdges(document),
    ]),
    installed: documents.flatMap(installedVersions),
  };
}

/** A snapshot key without its peer suffix: `foo@1.0.0(react@19.0.0)` → `foo@1.0.0`. */
function packageKey(key) {
  const peers = key.indexOf("(");
  return peers === -1 ? key : key.slice(0, peers);
}

/** A package's name without its version: `@scope/foo@1.0.0` → `@scope/foo`. */
function nameOf(holder) {
  return holder.slice(0, holder.indexOf("@", 1));
}

/** Whether an edge is a named tool's own copy, at the version it is named with. */
function isToolCopy({ holder, kind, version }, tools) {
  return kind === "package" && tools.get(nameOf(holder))?.version === version;
}

/** Edges on any version but the expected one, other than named tools' own copies. */
function wrongVersions(edges, expected, tools) {
  return edges
    .filter(edge => edge.version !== expected && !isToolCopy(edge, tools))
    .map(({ holder, kind, version }) =>
      kind === "importer"
        ? `workspace package ${holder} resolves typescript ${version}, not ${expected}`
        : `${holder} pulls in typescript ${version}, not ${expected}`
    );
}

/** Installed versions nothing depends on. */
function orphans(edges, installed) {
  const reached = new Set(edges.map(edge => edge.version));
  return installed
    .filter(version => !reached.has(version))
    .map(
      version => `typescript ${version} is installed and nothing depends on it`
    );
}

/**
 * Named copies that are gone. A stale exception would later excuse a version
 * nobody reviewed.
 */
function staleExceptions(edges, tools) {
  return [...tools]
    .filter(
      ([name, { version }]) =>
        !edges.some(
          edge =>
            edge.kind === "package" &&
            nameOf(edge.holder) === name &&
            edge.version === version
        )
    )
    .map(
      ([name, { version }]) =>
        `${name} no longer pulls in typescript ${version}; remove or update its exception`
    );
}

/**
 * Each way the lockfile breaks the rule, as a sentence naming the package to
 * change. Empty when it holds.
 */
export function violations(
  { edges, installed },
  expected = WORKSPACE_TYPESCRIPT,
  tools = TOOL_PRIVATE_TYPESCRIPT
) {
  return [
    ...wrongVersions(edges, expected, tools),
    ...orphans(edges, installed),
    ...staleExceptions(edges, tools),
  ];
}

/** A lockfile in pnpm's two-document layout, with the given edges. */
function fixture({
  importerVersion = "5.9.3",
  packages = [],
  unreached = [],
} = {}) {
  const lines = [
    "---",
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.5.1",
    "        version: 12.5.1",
    "",
    "---",
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  packages/app:",
    "    devDependencies:",
    "      typescript:",
    `        specifier: ^${importerVersion}`,
    `        version: ${importerVersion}`,
    "",
    "packages:",
    "",
  ];
  const versions = new Set([
    importerVersion,
    ...packages.map(([, version]) => version),
    // Installed with no edge to it, as an install left behind by a removed
    // dependency would be.
    ...unreached,
  ]);
  for (const version of versions) {
    lines.push(`  typescript@${version}:`, "    hasBin: true", "");
  }
  lines.push("snapshots:", "");
  for (const version of versions) lines.push(`  typescript@${version}: {}`, "");
  for (const [key, version] of packages) {
    lines.push(
      `  ${key}:`,
      "    dependencies:",
      `      typescript: ${version}`,
      ""
    );
  }
  return lines.join("\n");
}

const TOOLS = new Map([["tool", { version: "5.6.1-rc", reason: "test" }]]);

describe("reading a lockfile for TypeScript", () => {
  it("names an installed version that nothing depends on", () => {
    const found = violations(
      typescriptEdges(
        fixture({
          packages: [["tool@1.0.0", "5.6.1-rc"]],
          unreached: ["5.4.5"],
        })
      ),
      "5.9.3",
      TOOLS
    );
    expect(found).toEqual([
      "typescript 5.4.5 is installed and nothing depends on it",
    ]);
  });

  it("names the package that pulls in a second version", () => {
    const found = violations(
      typescriptEdges(
        fixture({
          packages: [
            ["tool@1.0.0", "5.6.1-rc"],
            ["sneaky@2.0.0(react@19.0.0)", "5.8.2"],
          ],
        })
      ),
      "5.9.3",
      TOOLS
    );
    expect(found).toEqual([
      "sneaky@2.0.0 pulls in typescript 5.8.2, not 5.9.3",
    ]);
  });

  it("names a workspace package on another version", () => {
    const found = violations(
      typescriptEdges(
        fixture({
          importerVersion: "5.8.2",
          packages: [["tool@1.0.0", "5.6.1-rc"]],
        })
      ),
      "5.9.3",
      TOOLS
    );
    expect(found).toEqual([
      "workspace package packages/app resolves typescript 5.8.2, not 5.9.3",
    ]);
  });

  it("accepts a named tool at its named version, at any version of the tool, and no other", () => {
    const named = typescriptEdges(
      fixture({ packages: [["tool@1.0.0", "5.6.1-rc"]] })
    );
    // The control that the tool's edge was read, so the silence below is a
    // verdict on it rather than its absence.
    expect(named.edges).toContainEqual({
      holder: "tool@1.0.0",
      kind: "package",
      version: "5.6.1-rc",
    });
    expect(violations(named, "5.9.3", TOOLS)).toEqual([]);
    const updated = typescriptEdges(
      fixture({ packages: [["tool@1.1.0", "5.6.1-rc"]] })
    );
    expect(violations(updated, "5.9.3", TOOLS)).toEqual([]);

    const moved = typescriptEdges(
      fixture({ packages: [["tool@1.0.0", "5.7.0"]] })
    );
    expect(violations(moved, "5.9.3", TOOLS)).toEqual([
      "tool@1.0.0 pulls in typescript 5.7.0, not 5.9.3",
      "tool no longer pulls in typescript 5.6.1-rc; remove or update its exception",
    ]);
  });
});

describe("this repository's lockfile", () => {
  it("resolves one TypeScript", () => {
    const read = typescriptEdges(readFileSync(LOCKFILE, "utf8"));
    // The population: both documents were read, the root importer is among
    // the holders, and the workspace's own version is installed.
    expect(read.importers).toBeGreaterThan(1);
    expect(read.edges).toContainEqual({
      holder: ".",
      kind: "importer",
      version: WORKSPACE_TYPESCRIPT,
    });
    expect(read.installed).toContain(WORKSPACE_TYPESCRIPT);
    expect(violations(read)).toEqual([]);
  });
});
