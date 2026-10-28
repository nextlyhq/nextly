/**
 * The committed component map checked against what a config declares, as
 * `generate:types --check` checks it in CI: by the paths its list holds, whether the generator
 * wrote the list on one line or a formatter laid it out a path a line, naming each component
 * missing (with its owner and widget) and each path no longer declared.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  configImportSpecifier,
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
    // Each under the member the generator writes for its path: what follows its `#`.
    ...paths.map(
      path =>
        `  ${JSON.stringify(path)}: _p0.${path.split("#")[1] ?? "default"},`
    ),
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

const check = () => checkComponentMapFiles([shop], TYPES, root, undefined);

/** Writes the two files as the generator writes them for `plugins`, importing `configImport`. */
async function generate(
  plugins: PluginDefinition[],
  configImport?: string
): Promise<void> {
  for (const artifact of buildImportMapArtifacts(
    plugins,
    TYPES,
    configImport
  )) {
    await writeFile(join(root, artifact.path), artifact.code);
  }
}

describe("a committed map that agrees with the config", () => {
  it("agrees when the list holds every declared component, laid out by a formatter", async () => {
    await commit(["@acme/shop/admin#Reports", "@acme/shop/admin#Revenue"]);
    const found = await check();
    expect(found.missing).toEqual([]);
    expect(found.obsolete).toEqual([]);
    expect(componentMapAgrees(found)).toBe(true);
  });

  it("agrees with the files exactly as the generator writes them", async () => {
    await generate([shop]);
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
    await generate([shop], "../../nextly.config");
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

describe("the config a map checks its widgets against", () => {
  const config = () => join(root, "nextly.config.ts");
  const importOf = (file: string) =>
    configImportSpecifier(join(root, DIR), join(root, file));

  it("agrees when the map imports the config the check loaded", async () => {
    await generate([shop], importOf("nextly.config.ts"));
    const found = await checkComponentMapFiles([shop], TYPES, root, config());
    expect(found.otherConfig).toBeUndefined();
    expect(componentMapAgrees(found)).toBe(true);
  });

  it("does not agree when the map was written for another config, naming both", async () => {
    await generate([shop], importOf("other.config.ts"));
    const found = await checkComponentMapFiles([shop], TYPES, root, config());
    expect(found.otherConfig).toEqual({
      written: "../../../other.config",
      expected: "../../../nextly.config",
    });
    expect(componentMapAgrees(found)).toBe(false);
  });

  it("does not agree when the map imports no config though one was loaded, nor the reverse", async () => {
    await generate([shop]);
    expect(
      (await checkComponentMapFiles([shop], TYPES, root, config())).otherConfig
    ).toEqual({ written: undefined, expected: "../../../nextly.config" });
    await generate([shop], importOf("nextly.config.ts"));
    expect((await check()).otherConfig).toEqual({
      written: "../../../nextly.config",
      expected: undefined,
    });
  });
});

describe("a map whose components are exported under names in any script", () => {
  const named = {
    name: "@acme/intl",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      admin: {
        pages: [
          { path: "cv", component: "@acme/intl/admin#Résumé" },
          { path: "parts", component: "@acme/intl/admin#组件" },
        ],
      },
    },
  } as unknown as PluginDefinition;

  it("agrees with the files the generator wrote for them", async () => {
    await generate([named]);
    const found = await checkComponentMapFiles([named], TYPES, root, undefined);
    expect(found.mapMatchesList).toBe(true);
    expect(componentMapAgrees(found)).toBe(true);
  });

  it("does not read an entry registered under another member than its path names", async () => {
    await generate([named]);
    const file = join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME);
    const code = await readFile(file, "utf-8");
    await writeFile(file, code.replace("_p0.组件,", "_p0.Other,"));
    expect(
      (await checkComponentMapFiles([named], TYPES, root, undefined))
        .mapMatchesList
    ).toBe(false);
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
