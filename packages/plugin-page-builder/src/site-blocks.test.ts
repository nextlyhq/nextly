/**
 * The server reads a site's own block registry, never an empty stand-in:
 * a read with no site registry refuses with a plain error, and no server
 * module reads the engine's bundle registry, which the admin's editor fills
 * in the browser and nothing fills on the server.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createBlockRegistry } from "@nextlyhq/blocks-engine";
import { SITE_BLOCKS_SERVICE } from "@nextlyhq/blocks-react";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { defineNamedQuery } from "@nextlyhq/plugin-sdk/blocks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGE_BUILDER_PLUGIN } from "./blocks/registration-service";
import { BLOCKS_FIELD_TYPE } from "./fields/blocksField";
import { blocksOf, namedQueriesOf, pageBuilder } from "./index";
import { SITE_NAMED_QUERIES_SERVICE } from "./plugin-definition/install-context";

/**
 * What the process's started instance offers, per test; `undefined` is an
 * instance that has not started, which refuses as the real one does.
 */
let offered: Record<string, Record<string, unknown>> | undefined;

vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<typeof import("nextly/runtime")>()),
  requireNextly: () => {
    if (offered === undefined) throw new Error("services not initialized");
    return { plugins: offered };
  },
}));

afterEach(() => {
  offered = undefined;
});

/** Once the runtime a page builder's lookups load has arrived. */
async function runtimeLoaded(): Promise<void> {
  await import("nextly/runtime");
  await Promise.resolve();
}

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

  it("refuses blocksOf() while no site has started, rather than answering no blocks", async () => {
    const builder = pageBuilder();
    const blocks = blocksOf(builder);
    await runtimeLoaded();
    expect(() => blocks.all()).toThrow(
      "[page-builder] blocksOf(): this page builder's site has not started"
    );
  });
});

describe("a page builder that did not start in this module copy", () => {
  // A production build bundles the plugin into each route, and the route's
  // copy of the page builder never starts: it reads the started site.
  it("reads its blocks through the started instance", async () => {
    const started = createBlockRegistry();
    started.register([
      {
        name: "acme/pricing",
        version: 1,
        description: "Pricing.",
        example: { props: {} },
        render: () => null,
      },
    ] as never);
    offered = {
      [SITE_BLOCKS_SERVICE.plugin]: { [SITE_BLOCKS_SERVICE.service]: started },
    };
    const blocks = blocksOf(pageBuilder());
    await runtimeLoaded();
    expect(blocks.has("acme/pricing")).toBe(true);
    expect(blocks.all().map(block => block.name)).toEqual(["acme/pricing"]);
  });

  it("reads its named queries through the started instance, the site's own before any start", async () => {
    const own = query("acme.own");
    const declared = query("acme.declared");
    const queries = namedQueriesOf(pageBuilder({ namedQueries: [own] }));
    await runtimeLoaded();
    expect(queries.definitionOf("acme.own")?.name).toBe("acme.own");
    expect(queries.definitionOf("acme.declared")).toBeUndefined();

    offered = {
      [PAGE_BUILDER_PLUGIN]: {
        [SITE_NAMED_QUERIES_SERVICE]: {
          definitionOf: (name: string) =>
            [own, declared].find(each => each.name === name),
        },
      },
    };
    expect(queries.definitionOf("acme.declared")?.name).toBe("acme.declared");
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
  const named = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@nextlyhq\/blocks-(?:engine|react)(?:\/[^"]*)?"/g;
  const reads: string[] = [];
  for (const match of source.matchAll(named)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
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
      bundleReadsIn('import { getBlock, type X } from "@nextlyhq/blocks-engine";')
    ).toEqual(["getBlock"]);
    expect(
      bundleReadsIn('import { registeredBlocks } from "@nextlyhq/blocks-react/x";')
    ).toEqual(["registeredBlocks"]);
    expect(bundleReadsIn("const r = react.registeredBlocks();")).toEqual([
      "registeredBlocks",
    ]);
  });
});
