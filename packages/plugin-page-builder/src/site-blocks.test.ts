/**
 * The server reads a site's own block registry, never an empty stand-in:
 * a read with no site registry refuses with a plain error, and no server
 * module reads the engine's bundle registry, which the admin's editor fills
 * in the browser and nothing fills on the server.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createBlockRegistry } from "@nextlyhq/blocks-engine";
import { SITE_BLOCKS_SERVICE, siteCopyOf } from "@nextlyhq/blocks-react";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { defineNamedQuery } from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it } from "vitest";

import {
  createBlockRegistrationService,
  PAGE_BUILDER_PLUGIN,
} from "./blocks/registration-service";
import { BLOCKS_FIELD_TYPE } from "./fields/blocksField";
import { blocksOf, namedQueriesOf, pageBuilder } from "./index";

/** A named query with nothing to read, under `name`. */
function query(name: string) {
  return defineNamedQuery({
    name,
    label: name,
    description: name,
    params: {},
    reads: { collections: [] },
    rows: { key: "id", fields: [{ name: "id", type: "text" }] },
    async run() {
      return { rows: [] };
    },
  });
}

/** A page holding one block, as a save would hand it over. */
const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "b1", type: "core/text", version: 1, props: {} }],
};

describe("a server read with no site registry", () => {
  it("refuses to judge a document, rather than judging it against no blocks", async () => {
    const judged = Promise.resolve().then(() =>
      BLOCKS_FIELD_TYPE.validate?.(page, {
        path: "content",
        field: { name: "content", type: "blocks" },
        data: {},
        mode: "create",
      } as never)
    );
    await expect(judged).rejects.toThrow(
      "[page-builder] the site's block registry is not installed"
    );
  });

  it("refuses blocksOf() for a plugin that is not a page builder", () => {
    const other = definePlugin({
      name: "@acme/other",
      version: "1.0.0",
      nextly: ">=0.0.0",
    });
    expect(() => blocksOf(other)).toThrow(/is not one/);
  });

  it("offers its blocks under the name the routes read", () => {
    expect(SITE_BLOCKS_SERVICE.plugin).toBe(PAGE_BUILDER_PLUGIN);
  });

  it("refuses blocksOf() while no site has started, rather than answering no blocks", () => {
    const blocks = blocksOf(pageBuilder());
    expect(() => blocks.all()).toThrow(
      "[page-builder] this page builder's site has not started"
    );
    // Marked as not started, so a route reads the started site instead.
    expect(siteCopyOf(blocks)?.started()).toBe(false);
  });
});

describe("a page builder that did not start in this module copy", () => {
  // Runs after the refusal above: once a boot here has started a registry,
  // a page builder that never started reads it, as a dev server's config
  // reload leaves the running site's blocks with a new, unstarted definition.
  it("reads the registry the last boot here started", () => {
    const started = createBlockRegistry();
    createBlockRegistrationService(started);
    started.register([
      {
        name: "acme/pricing",
        version: 1,
        description: "Pricing.",
        example: { props: {} },
        render: () => null,
      },
    ] as never);
    const blocks = blocksOf(pageBuilder());
    expect(blocks.has("acme/pricing")).toBe(true);
    expect(blocks.all().map(block => block.name)).toEqual(["acme/pricing"]);
    expect(siteCopyOf(blocks)?.started()).toBe(true);
  });

  it("marks its named queries, answering the site's own until a route reads the started site", () => {
    const own = query("acme.own");
    const queries = namedQueriesOf(pageBuilder({ namedQueries: [own] }));
    expect(queries.definitionOf("acme.own")?.name).toBe("acme.own");
    expect(siteCopyOf(queries)?.started()).toBe(false);
  });
});

/** The engine's and the renderer's bundle-registry functions. */
const BUNDLE_READS = new Set([
  "registerBlocks",
  "registerSupport",
  "getBlock",
  "hasBlock",
  "allBlocks",
  "getBlockSource",
  "getSupport",
  "allSupports",
  "clearBlocks",
  "registryLookup",
  "registryNestingSource",
  "registryBlockSource",
  "registryMigrationSource",
  "registeredBlocks",
]);

/** Every server source file: outside `admin/`, not a test. */
function serverSources(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "admin" || name === "__tests__") continue;
      found.push(...serverSources(path));
    } else if (/\.tsx?$/.test(name) && !/\.test(-d)?\.tsx?$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/** The names a file imports from the engine or the renderer. */
function bundleReadsIn(source: string): string[] {
  const named =
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@nextlyhq\/blocks-(?:engine|react)(?:\/[^"]*)?"/g;
  const reads: string[] = [];
  for (const match of source.matchAll(named)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name !== undefined && BUNDLE_READS.has(name)) reads.push(name);
    }
  }
  // One reached through a namespace or a dynamic import, `react.registeredBlocks()`.
  // `registerSupport` is left out here: a site registry and the registration
  // service have a method of that name.
  for (const match of source.matchAll(/\b\w+\.(\w+)\(/g)) {
    const name = match[1];
    if (
      name !== undefined &&
      name !== "registerSupport" &&
      BUNDLE_READS.has(name)
    ) {
      reads.push(name);
    }
  }
  return reads;
}

describe("the server's registry reads", () => {
  it("never reach the engine's bundle registry", () => {
    const root = import.meta.dirname;
    const offending = serverSources(root)
      .map(path => ({
        file: relative(root, path),
        reads: bundleReadsIn(readFileSync(path, "utf8")),
      }))
      .filter(found => found.reads.length > 0);
    expect(offending).toEqual([]);
  });

  it("would see such a read, named or through a namespace", () => {
    expect(
      bundleReadsIn(
        'import { getBlock, type X } from "@nextlyhq/blocks-engine";'
      )
    ).toEqual(["getBlock"]);
    expect(
      bundleReadsIn(
        'import { registeredBlocks } from "@nextlyhq/blocks-react/x";'
      )
    ).toEqual(["registeredBlocks"]);
    expect(bundleReadsIn("const r = react.registeredBlocks();")).toEqual([
      "registeredBlocks",
    ]);
  });
});
