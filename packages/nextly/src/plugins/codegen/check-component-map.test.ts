/**
 * The committed component map checked against what a config declares, as
 * `generate:types --check` checks it in CI: by the paths its list holds, whether the generator
 * wrote the list on one line or a formatter laid it out a path a line, naming each component
 * missing (with its owner and widget) and each path no longer declared.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";

import {
  checkComponentMapFiles,
  componentMapAgrees,
} from "./check-component-map";
import {
  buildImportMapArtifacts,
  COMPONENT_IMPORT_MAP_FILENAME,
  COMPONENT_PATHS_FILENAME,
  listedPathsOf,
  mapRegisteredPathsOf,
} from "./component-import-map";

const shop = {
  name: "@acme/shop",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    admin: {
      pages: [{ path: "reports", component: "@acme/shop/admin#Reports" }],
    },
    dashboard: {
      widgets: [
        {
          id: "acme/revenue",
          view: { component: "@acme/shop/admin#Revenue" },
        },
      ],
    },
  },
} as unknown as PluginDefinition;

const TYPES = "src/types/generated/nextly-types.ts";
const DIR = "src/types/generated";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nextly-map-check-"));
  await mkdir(join(root, DIR), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A map registering `paths`, in the shape the generator writes its `registered` object. */
const mapOf = (paths: readonly string[]) =>
  [
    "export const componentMapAgreesWithList = true;",
    "",
    "const registered = {",
    ...paths.map((path, index) => `  ${JSON.stringify(path)}: _p0.C${index},`),
    "};",
    "",
  ].join("\n");

/** Commits a map registering `paths`, and a list of them laid out a path a line, as a formatter leaves it. */
async function commit(paths: readonly string[]): Promise<void> {
  await writeFile(join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME), mapOf(paths));
  await writeFile(
    join(root, DIR, COMPONENT_PATHS_FILENAME),
    `export const registeredComponentPaths = [\n${paths
      .map(path => `  ${JSON.stringify(path)},\n`)
      .join("")}] as const;\n`
  );
}

const check = () => checkComponentMapFiles([shop], TYPES, root);

describe("a committed map that agrees with the config", () => {
  it("agrees when the list holds every declared component, laid out by a formatter", async () => {
    await commit(["@acme/shop/admin#Reports", "@acme/shop/admin#Revenue"]);
    const found = await check();
    expect(found.missing).toEqual([]);
    expect(found.obsolete).toEqual([]);
    expect(componentMapAgrees(found)).toBe(true);
  });

  it("agrees with the files exactly as the generator writes them", async () => {
    for (const artifact of buildImportMapArtifacts([shop], TYPES)) {
      await writeFile(join(root, artifact.path), artifact.code);
    }
    expect(componentMapAgrees(await check())).toBe(true);
  });
});

describe("a committed map that does not", () => {
  it("names a missing widget component with its owner and its widget", async () => {
    await commit(["@acme/shop/admin#Reports"]);
    const found = await check();
    expect(componentMapAgrees(found)).toBe(false);
    expect(found.missing).toEqual([
      {
        path: "@acme/shop/admin#Revenue",
        owner: 'plugin "@acme/shop"',
        use: "widget",
        widget: "acme/revenue",
      },
    ]);
  });

  it("names a missing page component by its use", async () => {
    await commit(["@acme/shop/admin#Revenue"]);
    const found = await check();
    expect(found.missing.map(each => [each.path, each.use])).toEqual([
      ["@acme/shop/admin#Reports", "page"],
    ]);
  });

  it("names a path the list holds that nothing declares", async () => {
    await commit([
      "@acme/shop/admin#Reports",
      "@acme/shop/admin#Revenue",
      "@gone/old/admin#Chart",
    ]);
    const found = await check();
    expect(found.missing).toEqual([]);
    expect(found.obsolete).toEqual(["@gone/old/admin#Chart"]);
    expect(componentMapAgrees(found)).toBe(false);
  });

  it("names each file that is not there", async () => {
    const found = await check();
    expect(found.absent).toEqual([
      join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME),
      join(root, DIR, COMPONENT_PATHS_FILENAME),
    ]);
    expect(componentMapAgrees(found)).toBe(false);
  });

  it("does not agree when the map is absent though the list agrees", async () => {
    await commit(["@acme/shop/admin#Reports", "@acme/shop/admin#Revenue"]);
    await rm(join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME));
    expect(componentMapAgrees(await check())).toBe(false);
  });

  it("does not agree with a list it cannot read, however its paths happen to read", async () => {
    await writeFile(join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME), mapOf([]));
    await writeFile(
      join(root, DIR, COMPONENT_PATHS_FILENAME),
      "export const registeredComponentPaths = PATHS as const;\n"
    );
    const found = await check();
    expect(found.listReadable).toBe(false);
    expect(componentMapAgrees(found)).toBe(false);
  });
});

describe("a map that no longer registers what its list names", () => {
  it("does not agree when the map is emptied though its list still agrees", async () => {
    await commit(["@acme/shop/admin#Reports", "@acme/shop/admin#Revenue"]);
    await writeFile(
      join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME),
      "// the map\n"
    );
    const found = await check();
    expect(found.missing).toEqual([]);
    expect(found.mapMatchesList).toBe(false);
    expect(componentMapAgrees(found)).toBe(false);
  });

  it("does not agree when the map registers other paths than its list", async () => {
    await commit(["@acme/shop/admin#Reports", "@acme/shop/admin#Revenue"]);
    await writeFile(
      join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME),
      mapOf(["@acme/shop/admin#Reports"])
    );
    expect((await check()).mapMatchesList).toBe(false);
  });

  it("agrees with a map the generator wrote, its widget notes included", async () => {
    for (const artifact of buildImportMapArtifacts(
      [shop],
      TYPES,
      "../../nextly.config"
    )) {
      await writeFile(join(root, artifact.path), artifact.code);
    }
    expect((await check()).mapMatchesList).toBe(true);
  });
});

describe("a map that hands the page builder its editor modules", () => {
  /** A map as the generator writes one where block editor modules are declared. */
  const withEditorEntries = (entries: string) =>
    [
      "export const componentMapAgreesWithList = true;",
      "",
      "const registered = {",
      '  "@/blocks/editor#Inspector": _p0.Inspector,',
      "};",
      "",
      "const blockEditorEntries = {",
      entries,
      "};",
      "",
    ].join("\n");

  it("registers its editor modules beside its components, as its own check holds them to its list", () => {
    expect(
      mapRegisteredPathsOf(
        withEditorEntries('  "@/blocks/editor#blocks": _p0.blocks,')
      )
    ).toEqual(["@/blocks/editor#Inspector", "@/blocks/editor#blocks"]);
  });

  it("registers nothing when its editor modules are edited into another shape", () => {
    expect(
      mapRegisteredPathsOf(withEditorEntries("  blocks: somewhere,"))
    ).toBeUndefined();
  });
});

describe("a list read back", () => {
  it("is read as the generator writes it, on one line", () => {
    expect(
      listedPathsOf(
        'export const registeredComponentPaths = ["a#A","b#B"] as const;\n'
      )
    ).toEqual(["a#A", "b#B"]);
  });

  it("is read as a formatter lays it out, a path a line with a trailing comma", () => {
    expect(
      listedPathsOf(
        'export const registeredComponentPaths = [\n  "a#A",\n  "b#B",\n] as const;\n'
      )
    ).toEqual(["a#A", "b#B"]);
  });

  it("reads an empty list as no paths", () => {
    expect(
      listedPathsOf("export const registeredComponentPaths = [] as const;")
    ).toEqual([]);
  });

  it("reads a path holding an escaped quote whole", () => {
    expect(
      listedPathsOf(
        `export const registeredComponentPaths = [${JSON.stringify('a"b#C')}] as const;`
      )
    ).toEqual(['a"b#C']);
  });

  it("reads a path whose route folder holds brackets whole, as one path", () => {
    expect(
      listedPathsOf(
        'export const registeredComponentPaths = [\n  "@/app/[slug]/Widget#default",\n  "b#B",\n] as const;\n'
      )
    ).toEqual(["@/app/[slug]/Widget#default", "b#B"]);
  });

  it("reads nothing from a list holding anything but strings", () => {
    expect(
      listedPathsOf(
        'export const registeredComponentPaths = ["a#A", other] as const;'
      )
    ).toBeUndefined();
  });
});
