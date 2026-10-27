import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listedFiles } from "../../../../../scripts/tsc-cli.mjs";

import { buildPluginAdminMeta, type PluginAdminMeta } from "../admin-meta";
import type { PluginDefinition } from "../plugin-context";
import {
  buildComponentImportMap,
  buildImportMapArtifacts,
  collectAdminComponentPaths,
  collectBlockEditorComponentPaths,
  buildComponentPathsModule,
  componentImportMapEntries,
  componentImportMapPaths,
  configImportSpecifier,
} from "./component-import-map";

function plugin(admin: unknown, enabled?: boolean): PluginDefinition {
  return {
    name: "@acme/x",
    version: "1.0.0",
    nextly: "*",
    enabled,
    contributes: { admin },
  } as unknown as PluginDefinition;
}

describe("buildComponentImportMap", () => {
  it("imports each module once and registers every page/settings/view component", () => {
    const p = plugin({
      menu: [{ label: "X", to: "/x" }], // no component — must not appear
      pages: [{ path: "reports", component: "@acme/x/admin#Reports" }],
      settings: { component: "@acme/x/admin#Settings" },
      views: {
        forms: {
          beforeList: "@acme/x/admin#FormsFilter",
          edit: "@acme/y/views#FormEdit",
        },
      },
    });

    const code = buildComponentImportMap([p]);

    // One namespace import per unique module.
    expect(code).toContain('import * as _p0 from "@acme/x/admin";');
    expect(code).toContain('import * as _p1 from "@acme/y/views";');
    expect(code).toContain(
      'import { registerComponents } from "@nextlyhq/admin";'
    );
    // Each component registered by its full path → namespace member.
    expect(code).toContain('"@acme/x/admin#Reports": _p0.Reports,');
    expect(code).toContain('"@acme/x/admin#Settings": _p0.Settings,');
    expect(code).toContain('"@acme/x/admin#FormsFilter": _p0.FormsFilter,');
    expect(code).toContain('"@acme/y/views#FormEdit": _p1.FormEdit,');
    // Menu route ("/x") is not registered as a component (would be a quoted key).
    expect(code).not.toContain('"/x"');
  });

  it("registers each document view's component, so the admin can load it", () => {
    const p = plugin({
      views: {
        pages: {
          documentViews: [
            { path: "builder", component: "@acme/x/admin#Builder" },
            { path: "preview", component: "@acme/x/admin#Preview" },
          ],
        },
      },
    });

    const code = buildComponentImportMap([p]);
    // The admin resolves a view by this string; one missing from the map is a
    // route that draws nothing.
    expect(code).toContain('"@acme/x/admin#Builder": _p0.Builder,');
    expect(code).toContain('"@acme/x/admin#Preview": _p0.Preview,');
  });

  it("registers a field-type document view's component too", () => {
    const p = plugin({
      documentViews: [
        {
          path: "builder",
          fieldType: "blocks",
          component: "@acme/x/admin#Builder",
        },
      ],
    });
    expect(buildComponentImportMap([p])).toContain(
      '"@acme/x/admin#Builder": _p0.Builder,'
    );
  });

  it("dedupes repeated paths and maps a default export (no #) to .default", () => {
    const p = plugin({
      pages: [
        { path: "a", component: "@acme/x/admin#Dup" },
        { path: "b", component: "@acme/x/admin#Dup" },
      ],
      settings: { component: "@acme/x/admin/Default" },
    });

    const code = buildComponentImportMap([p]);
    expect(code.split('"@acme/x/admin#Dup":').length - 1).toBe(1); // deduped
    // "@acme/x/admin/Default" (no #) is its own module → default export, distinct alias.
    expect(code).toMatch(/"@acme\/x\/admin\/Default": _p\d+\.default,/);
  });

  it("skips disabled plugins and returns a no-op module when empty", () => {
    expect(
      collectAdminComponentPaths(
        plugin({ pages: [{ path: "a", component: "@x#Y" }] }, false)
      )
    ).toEqual([]);

    const code = buildComponentImportMap([]);
    expect(code).toContain("const registered = {\n};");
    expect(code).not.toContain("registerComponents");
  });
});

describe("the map's check against the site's config", () => {
  const shop = plugin({
    pages: [{ path: "reports", component: "@acme/x/admin#Reports" }],
  });

  it("imports the config's type, and checks the registered components against it", () => {
    const code = buildComponentImportMap([shop], "../../nextly.config");
    expect(code).toContain(
      'import type { DeclaredComponentMap } from "nextly";'
    );
    expect(code).toContain(
      'import type * as siteConfig from "../../nextly.config";'
    );
    expect(code).toContain(
      "} satisfies DeclaredComponentMap<typeof siteConfig>;"
    );
    // Type-only, so the config's server code never reaches the browser bundle.
    expect(code).not.toMatch(/^import (?!type)[^\n]*nextly\.config/m);
  });

  it("writes the map unchecked, as before, where there is no config file", () => {
    const code = buildComponentImportMap([shop]);
    expect(code).not.toContain("siteConfig");
    expect(code).not.toContain("satisfies");
    expect(code).toContain('"@acme/x/admin#Reports": _p0.Reports,\n};');
  });

  it("passes the config's import through to the map and not to its path list", () => {
    const [map, list] = buildImportMapArtifacts(
      [shop],
      "src/types/generated/nextly-types.ts",
      "../../../nextly.config"
    );
    expect(map?.code).toContain('from "../../../nextly.config";');
    expect(list?.code).not.toContain("nextly.config");
  });

  it.each([
    [
      "/app/src/types/generated",
      "/app/nextly.config.ts",
      "../../../nextly.config",
    ],
    // An ESM config keeps its module extension, written as the output's (`.mjs` for an `.mts`
    // source, which TypeScript maps back): an extensionless specifier resolves to neither under
    // the site's Bundler resolution.
    [
      "/app/src/types/generated",
      "/app/src/nextly.config.mts",
      "../../nextly.config.mjs",
    ],
    ["/app", "/app/nextly.config.mjs", "./nextly.config.mjs"],
    ["/app/types", "/app/config/nextly.config.js", "../config/nextly.config"],
  ])("imports the config from %s as it sits at %s", (dir, file, expected) => {
    expect(configImportSpecifier(dir, file)).toBe(expected);
  });
});

// What the string is for: the site's compiler resolving it to the config. Checked with the
// TypeScript command line under the Bundler resolution a Next.js site uses, against real files,
// since a specifier only reads right if it also resolves: the config is in the program a file
// importing it loads only if the specifier reached it.
describe("the config specifier, as the site's compiler resolves it", () => {
  it.each(["nextly.config.mts", "nextly.config.mjs", "nextly.config.ts"])(
    "resolves %s from the generated map's directory",
    file => {
      const root = mkdtempSync(join(tmpdir(), "config-specifier-"));
      try {
        const mapDir = join(root, "src", "types", "generated");
        mkdirSync(mapDir, { recursive: true });
        writeFileSync(join(root, file), "export default {};\n");
        const specifier = configImportSpecifier(mapDir, join(root, file));
        writeFileSync(
          join(mapDir, "nextly-component-map.ts"),
          `import config from ${JSON.stringify(specifier)};\nexport const read = config;\n`
        );
        const config = join(root, "tsconfig.json");
        writeFileSync(
          config,
          JSON.stringify({
            compilerOptions: {
              module: "esnext",
              moduleResolution: "bundler",
              allowJs: true,
              noEmit: true,
              types: [],
            },
            files: ["src/types/generated/nextly-component-map.ts"],
          })
        );
        // The listed paths have forward slashes on every platform, while `join` uses the
        // platform separator, so both sides compare in the forward-slash form.
        expect(listedFiles(config)).toContain(
          join(root, file).replaceAll("\\", "/")
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});

describe("buildImportMapArtifacts", () => {
  it("returns the map and its path list, placed alongside the generated types file", () => {
    const p = plugin({ settings: { component: "@acme/x/admin#Settings" } });
    const [map, list] = buildImportMapArtifacts(
      [p],
      "./src/types/nextly-types.ts"
    );

    expect(map.path.replace(/\\/g, "/")).toMatch(
      /src\/types\/plugin-admin-imports\.generated\.ts$/
    );
    expect(map.code).toContain("registerComponents");
    expect(list.path.replace(/\\/g, "/")).toMatch(
      /src\/types\/plugin-admin-components\.generated\.ts$/
    );
    // The list has no import statement, so server code can read it without
    // loading a component. (Its comment may say "import"; a statement may not.)
    expect(list.code).not.toMatch(/^\s*import\b/m);
    expect(list.code).toContain('["@acme/x/admin#Settings"]');
  });

  it("returns both, empty, when no plugin contributes admin components", () => {
    // The admin page and layout import them, so an empty app still has both.
    const p = plugin({ menu: [{ label: "X", to: "/x" }] }); // menu has no component
    for (const plugins of [[p], []]) {
      const [map, list] = buildImportMapArtifacts(plugins, "./types.ts");
      expect(map.code).not.toContain("registerComponents");
      expect(list.code).toContain(
        "export const registeredComponentPaths = [] as const;"
      );
    }
  });
});

/** The page builder itself, without which no block can register. */
function pageBuilder(enabled?: boolean): PluginDefinition {
  return {
    name: "@nextlyhq/plugin-page-builder",
    version: "1.0.0",
    nextly: "*",
    enabled,
  } as unknown as PluginDefinition;
}

/** A plugin declaring blocks for the page builder. */
function declaringBlocks(
  blocks: unknown[],
  enabled?: boolean
): PluginDefinition {
  return {
    name: "@acme/blocks",
    version: "1.0.0",
    nextly: "*",
    enabled,
    contributes: {
      declarations: { "@nextlyhq/plugin-page-builder": { blocks } },
    },
  } as unknown as PluginDefinition;
}

describe("block editor components", () => {
  it("collects the editor component a declared block names", () => {
    const paths = collectBlockEditorComponentPaths([
      pageBuilder(),
      declaringBlocks([
        { name: "acme/hero", editor: { component: "@acme/blocks/admin#Hero" } },
      ]),
    ]);

    expect(paths).toEqual(["@acme/blocks/admin#Hero"]);
  });

  it("registers them in the import map alongside admin components", () => {
    // The point of the seam: the editor bundle loads a contributed block's
    // inspector with no hand-written import, exactly as admin pages already do.
    const code = buildComponentImportMap([
      pageBuilder(),
      declaringBlocks([
        { name: "acme/hero", editor: { component: "@acme/blocks/admin#Hero" } },
      ]),
    ]);

    expect(code).toContain('"@acme/blocks/admin#Hero"');
    expect(code).toContain('import * as _p0 from "@acme/blocks/admin";');
  });

  it("emits a map for block components even with no admin contributions", () => {
    // Blocks alone fill the map; a map without them would leave a contributed
    // inspector unloadable.
    const [artifact] = buildImportMapArtifacts(
      [
        pageBuilder(),
        declaringBlocks([
          {
            name: "acme/hero",
            editor: { component: "@acme/blocks/admin#Hero" },
          },
        ]),
      ],
      "/app/src/nextly-types.ts"
    );

    expect(artifact.code).toContain('"@acme/blocks/admin#Hero"');
  });

  it("skips a disabled plugin's blocks", () => {
    expect(
      collectBlockEditorComponentPaths([
        declaringBlocks(
          [
            {
              name: "acme/hero",
              editor: { component: "@acme/blocks/admin#Hero" },
            },
          ],
          false
        ),
      ])
    ).toEqual([]);
  });

  it("ignores a block that names no editor component", () => {
    // Most blocks render from their prop schema and need no custom component.
    expect(
      collectBlockEditorComponentPaths([
        pageBuilder(),
        declaringBlocks([{ name: "acme/plain", version: 1 }]),
      ])
    ).toEqual([]);
  });

  it("skips a malformed declaration rather than failing generation", () => {
    // The manifest emitter already refuses these loudly; an import map is not
    // where a schema error should surface, and reporting it twice helps nobody.
    expect(
      collectBlockEditorComponentPaths([
        declaringBlocks("nope" as unknown as unknown[]),
      ])
    ).toEqual([]);
  });
});

describe("block editor entries", () => {
  /** A plugin declaring blocks and naming the module that exports them. */
  function declaringEntry(
    editorEntry: unknown,
    enabled?: boolean
  ): PluginDefinition {
    return {
      name: "@acme/blocks",
      version: "1.0.0",
      nextly: "*",
      enabled,
      contributes: {
        declarations: {
          "@nextlyhq/plugin-page-builder": {
            blocks: [{ name: "acme/hero", version: 1 }],
            editorEntry,
          },
        },
      },
    } as unknown as PluginDefinition;
  }

  const ENTRY = "@acme/blocks/editor#editorBlocks";

  it("lists the entry while the page builder is active, and hands it to the page builder", () => {
    const plugins = [pageBuilder(), declaringEntry(ENTRY)];

    expect(componentImportMapPaths(plugins)).toContain(ENTRY);
    const code = buildComponentImportMap(plugins);
    expect(code).toContain(
      'import { registerBlockEditorModules } from "@nextlyhq/plugin-page-builder/admin";'
    );
    expect(code).toContain(`"${ENTRY}": _p0.editorBlocks`);
    // Definitions are not a component: the component registry never sees it.
    expect(code).not.toContain("registerComponents(");
  });

  it("lists no entry while the page builder is absent or disabled", () => {
    for (const plugins of [
      [declaringEntry(ENTRY)],
      [pageBuilder(false), declaringEntry(ENTRY)],
    ]) {
      expect(componentImportMapPaths(plugins)).not.toContain(ENTRY);
      expect(buildComponentImportMap(plugins)).not.toContain(
        "registerBlockEditorModules"
      );
    }
  });

  it("skips a malformed entry rather than failing generation", () => {
    // The page builder refuses it at boot, naming the plugin.
    for (const malformed of [42, "", "   "]) {
      expect(
        componentImportMapPaths([pageBuilder(), declaringEntry(malformed)])
      ).toEqual([]);
    }
  });

  it("leaves a map with no block modules exactly as before", () => {
    // Every committed map of a site with no contributed blocks is unchanged.
    expect(buildComponentImportMap([pageBuilder()])).not.toContain(
      "blockEditorEntries"
    );
  });
});

describe("field-type and slot components", () => {
  it("collects a field type's editor component from a plugin with no admin contributions", () => {
    // The page builder is exactly this shape: one field type and no pages,
    // settings or views, so before field types were collected the generated
    // map imported nothing of it and its control could only arrive through
    // the registry's runtime import fallback — which cannot resolve a bare
    // package specifier in a bundled browser.
    const p = {
      name: "@nextlyhq/plugin-page-builder",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        fieldTypes: [
          {
            type: "blocks",
            storage: "json",
            component: "@nextlyhq/plugin-page-builder/admin#BlocksField",
          },
        ],
      },
    } as unknown as PluginDefinition;

    expect(collectAdminComponentPaths(p)).toEqual([
      "@nextlyhq/plugin-page-builder/admin#BlocksField",
    ]);

    const code = buildComponentImportMap([p]);
    expect(code).toContain(
      'import * as _p0 from "@nextlyhq/plugin-page-builder/admin";'
    );
    expect(code).toContain(
      '"@nextlyhq/plugin-page-builder/admin#BlocksField": _p0.BlocksField,'
    );

    // Field types alone are enough to need the file; returning null would
    // leave the control unloadable by an app that registers only the plugin.
    expect(
      buildImportMapArtifacts([p], "./src/types/nextly-types.ts")[0].code
    ).toContain("registerComponents");
  });

  it("collects the header slot under both spellings, the schema-builder slot and the form toolbar slot", () => {
    const p = plugin({
      header: { slot: "@acme/x/admin#HeaderSlot" },
      schemaBuilderSlot: "@acme/x/admin#SchemaSlot",
      entryFormToolbarSlot: "@acme/x/admin#ToolbarSlot",
    });

    expect(collectAdminComponentPaths(p)).toEqual([
      "@acme/x/admin#HeaderSlot",
      "@acme/x/admin#SchemaSlot",
      "@acme/x/admin#ToolbarSlot",
    ]);
  });

  it("honors the deprecated top-level headerSlot spelling", () => {
    // Still folded into `header.slot` by admin-meta, so the map must read it
    // the same way rather than dropping a back-compat plugin's component.
    const p = plugin({ headerSlot: "@acme/x/admin#LegacySlot" });
    expect(collectAdminComponentPaths(p)).toEqual(["@acme/x/admin#LegacySlot"]);
  });

  it("keeps a disabled plugin's field-type editors but drops its slots", () => {
    // admin-meta serializes fieldTypes regardless of enabled state — a
    // disabled plugin keeps its collections and their fields, so their
    // editors still mount and still need their modules imported. Behavioral
    // UI (pages, settings, slots) is withheld for a disabled plugin.
    const p = {
      name: "@acme/x",
      version: "1.0.0",
      nextly: "*",
      enabled: false,
      contributes: {
        fieldTypes: [
          { type: "rating", storage: "json", component: "@x/admin#Rating" },
        ],
        admin: { schemaBuilderSlot: "@x/admin#SchemaSlot" },
      },
    } as unknown as PluginDefinition;

    expect(collectAdminComponentPaths(p)).toEqual(["@x/admin#Rating"]);
  });
});

/**
 * Meta keys that carry no `ComponentPath`, whatever else they carry.
 *
 * Listed rather than inferred so that a key added to `PluginAdminMeta` lands
 * in neither this set nor the readers below and is reported as
 * `unclassified` — which is where this guard's teeth are. Someone then has
 * to answer whether the new key names a component, instead of the map
 * quietly not importing it.
 */
const KEYS_WITHOUT_COMPONENTS = new Set([
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "docsUrl",
  "license",
  "category",
  "tags",
  "enabled",
  "dependsOn",
  "placement",
  "order",
  "after",
  "appearance",
  "collections",
  "singles",
  "fieldGroups",
  "clientConfig",
  "routes",
  "whenEnabled",
  // Menu items carry a route (`to`), never a component.
  "menu",
]);

interface ExposedPaths {
  /** Paths the admin resolves through the registry — each needs an import. */
  registered: string[];
  /** Widget component paths: deliberately NOT imported into the generated map. */
  widgets: string[];
  /** Emitted keys this helper classifies neither way. Must stay empty. */
  unclassified: string[];
}

/**
 * Every component path a serialized admin-meta entry carries, read BY KEY.
 *
 * Scanning the serialized JSON for `"…#…"` instead would be both too eager
 * and too slack: `clientConfig` is arbitrary plugin data, so a branding hex
 * like `#0ea5e9` reads as a component path, and a path naming a default
 * export carries no `#` at all and is missed entirely. Reading the keys the
 * serializer writes makes the set exact, and makes the widget exclusion
 * something these tests STATE rather than something they happen not to
 * notice.
 *
 * Written from the meta's shape rather than by calling the collector, so
 * the two remain independent statements of the same set — a collector bug
 * copied into the guard would assert nothing.
 *
 * Bounded by what the FIXTURE exercises: a key no fixture declares is never
 * serialized and cannot be seen from here, so the fixtures below carry one
 * of everything on purpose.
 */
function exposedComponentPaths(meta: PluginAdminMeta): ExposedPaths {
  const registered = [
    ...(meta.pages ?? []).map(page => page.component),
    meta.settings?.component,
    // Mirrored spellings, both serialized; the map must read whichever the
    // browser is handed.
    meta.headerSlot,
    meta.header?.slot,
    meta.schemaBuilderSlot,
    meta.entryFormToolbarSlot,
    ...(meta.fieldTypes ?? []).map(fieldType => fieldType.component),
  ].filter((path): path is string => Boolean(path));

  const readsComponents = new Set([
    "pages",
    "settings",
    "headerSlot",
    "header",
    "schemaBuilderSlot",
    "entryFormToolbarSlot",
    "fieldTypes",
  ]);

  return {
    registered,
    // A widget's component is OPTIONAL now: a declarative widget names an
    // archetype and a query and ships no UI code, so it exposes no path for
    // the import map to carry. Dropped rather than collected as `undefined`,
    // because this list is what the map's coverage is measured against and an
    // absent path is not an uncovered one.
    widgets: (meta.widgets ?? []).flatMap(widget =>
      widget.component === undefined ? [] : [widget.component]
    ),
    unclassified: Object.keys(meta).filter(
      key =>
        !readsComponents.has(key) &&
        key !== "widgets" &&
        !KEYS_WITHOUT_COMPONENTS.has(key)
    ),
  };
}

describe("parity with the admin-meta surface", () => {
  it("collects every component path admin-meta exposes for a plugin", () => {
    // One of every kind, so the key sweep above sees the whole surface: the
    // widget it must NOT import, and a `clientConfig` hex that a `#` scan
    // would have demanded an import for.
    const p = {
      name: "@acme/x",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        fieldTypes: [
          {
            type: "rating",
            storage: "json",
            component: "@acme/x/admin#Rating",
          },
        ],
        admin: {
          menu: [{ label: "X", to: "/x" }],
          pages: [{ path: "reports", component: "@acme/x/admin#Reports" }],
          settings: { component: "@acme/x/admin#Settings" },
          header: { slot: "@acme/x/admin#HeaderSlot" },
          schemaBuilderSlot: "@acme/x/admin#SchemaSlot",
          entryFormToolbarSlot: "@acme/x/admin#ToolbarSlot",
          widgets: [
            { id: "stats", component: "@acme/x/admin#StatsWidget" },
            // A DECLARATIVE widget beside it: an archetype and a query, no UI
            // code. It must contribute no path at all -- see the assertion at
            // the end of this test.
            {
              id: "posts",
              archetype: "metric",
              query: { source: "collection:posts", op: "count" },
            },
          ],
          clientConfig: { accent: "#0ea5e9" },
        },
      },
    } as unknown as PluginDefinition;

    const meta = buildPluginAdminMeta([p], undefined)[0];
    const exposed = exposedComponentPaths(meta);

    // The guard itself: every key the meta emits is accounted for. A new one
    // fails here, before the assertions that depend on knowing what it is.
    expect(exposed.unclassified).toEqual([]);

    // Positive control — without it the loop below is satisfied by an empty
    // probe.
    expect(exposed.registered).toEqual(
      expect.arrayContaining([
        "@acme/x/admin#Rating",
        "@acme/x/admin#Reports",
        "@acme/x/admin#Settings",
        "@acme/x/admin#HeaderSlot",
        "@acme/x/admin#SchemaSlot",
        "@acme/x/admin#ToolbarSlot",
      ])
    );

    const collected = new Set([
      ...collectAdminComponentPaths(p),
      ...collectBlockEditorComponentPaths([p]),
    ]);
    for (const path of exposed.registered) {
      expect(collected.has(path)).toBe(true);
    }

    // Widget components ARE collected now, and this records why the exclusion
    // ended rather than only that it did.
    //
    // Being pre-bundled by this map is what puts a component in the registry
    // `PluginSlot` reads -- the registry's runtime fallback cannot resolve a
    // bare package specifier in a bundled browser. So while widgets were
    // excluded, a `custom` widget drew its card and then nothing inside it
    // unless the plugin called `registerComponents` itself from its admin
    // entry, which the documented contract never asked it to do.
    expect(exposed.widgets).toEqual(["@acme/x/admin#StatsWidget"]);

    // A DECLARATIVE widget still contributes no path whatsoever. The fixture
    // declares two widgets and only one names a component: the host draws the
    // other from its archetype and query, so there is nothing for any import
    // map to carry for it. Without this the assertion above could be read as
    // "widgets contribute one path each", which stopped being true when
    // `component` became conditional.
    expect(meta.widgets).toHaveLength(2);
    expect(exposed.widgets).toHaveLength(1);
    expect(collected.has("@acme/x/admin#StatsWidget")).toBe(true);

    // `clientConfig` is plugin data. A colour is not a component path, and
    // reading it as one would demand an import for a module named `#0ea5e9`.
    expect(meta.clientConfig).toEqual({ accent: "#0ea5e9" });
    expect(collected.has("#0ea5e9")).toBe(false);
  });

  it("covers a disabled plugin too, whose meta keeps its field types", () => {
    // admin-meta withholds a disabled plugin's behavioral UI but still
    // serializes its field types (retained collections keep rendering their
    // fields), so the collector must import those editors or the fields of a
    // disabled plugin render empty.
    const p = {
      name: "@acme/off",
      version: "1.0.0",
      nextly: "*",
      enabled: false,
      contributes: {
        fieldTypes: [
          {
            type: "rating",
            storage: "json",
            component: "@acme/off/admin#Rating",
          },
        ],
        admin: {
          pages: [{ path: "reports", component: "@acme/off/admin#Reports" }],
          schemaBuilderSlot: "@acme/off/admin#SchemaSlot",
        },
      },
    } as unknown as PluginDefinition;

    const meta = buildPluginAdminMeta([p], undefined)[0];
    const exposed = exposedComponentPaths(meta);

    expect(exposed.unclassified).toEqual([]);
    // Exact, not a superset: the page and the slot are withheld for a
    // disabled plugin, and the field type is not.
    expect(exposed.registered).toEqual(["@acme/off/admin#Rating"]);

    const collected = new Set(collectAdminComponentPaths(p));
    for (const path of exposed.registered) {
      expect(collected.has(path)).toBe(true);
    }
  });
});

describe("block editor components without an active page builder", () => {
  it("collects nothing when the page builder is absent", () => {
    // No page builder, no registry for the blocks to land in, so importing
    // their editor components eagerly would load a feature that cannot run.
    expect(
      collectBlockEditorComponentPaths([
        declaringBlocks([
          {
            name: "acme/hero",
            editor: { component: "@acme/blocks/admin#Hero" },
          },
        ]),
      ])
    ).toEqual([]);
  });

  it("collects nothing when the page builder is disabled", () => {
    expect(
      collectBlockEditorComponentPaths([
        pageBuilder(false),
        declaringBlocks([
          {
            name: "acme/hero",
            editor: { component: "@acme/blocks/admin#Hero" },
          },
        ]),
      ])
    ).toEqual([]);
  });
});

describe("widgets declared under contributes.dashboard", () => {
  /** A plugin declaring widgets, as plain JavaScript would hand them over. */
  function declaring(widgets: unknown, enabled?: boolean): PluginDefinition {
    return {
      name: "@acme/shop",
      version: "1.0.0",
      nextly: "*",
      enabled,
      contributes: { dashboard: { widgets } },
    } as unknown as PluginDefinition;
  }

  it("collects the component a declared widget draws with, from a plugin with no admin contributions", () => {
    const shop = declaring([
      {
        id: "acme/revenue",
        view: { component: "@acme/shop/admin#Revenue" },
      },
      // A core view ships no component, so it contributes no path.
      { id: "acme/orders", view: "list" },
    ]);
    expect(collectAdminComponentPaths(shop)).toEqual([
      "@acme/shop/admin#Revenue",
    ]);
    expect(buildComponentImportMap([shop])).toContain(
      '"@acme/shop/admin#Revenue": _p0.Revenue,'
    );
  });

  it("collects nothing from a disabled plugin, and skips entries that name no component", () => {
    expect(
      collectAdminComponentPaths(
        declaring(
          [{ id: "a/b", view: { component: "@acme/shop/admin#Revenue" } }],
          false
        )
      )
    ).toEqual([]);
    // Malformed entries are startup's to refuse, by name; the map skips them.
    expect(
      collectAdminComponentPaths(
        declaring([
          null,
          { view: { component: "" } },
          { view: { component: 3 } },
          { view: null },
          // The field a declaration named its component under before `view`:
          // startup refuses it by name, and the map does not read it.
          { id: "a/old", display: { component: "@acme/shop/admin#Old" } },
        ])
      )
    ).toEqual([]);
    expect(collectAdminComponentPaths(declaring("not a list"))).toEqual([]);
  });
});

describe("the list of paths the map registers", () => {
  it("is exported by the generated map, the same list it registers", () => {
    const p = plugin({
      pages: [{ path: "a", component: "@acme/x/admin#B" }],
      settings: { component: "@acme/x/admin#A" },
    });
    const paths = componentImportMapPaths([p]);
    expect(paths).toEqual(["@acme/x/admin#A", "@acme/x/admin#B"]);
    // The map re-exports its list, the one it is held to.
    expect(buildComponentImportMap([p])).toContain(
      'import { registeredComponentPaths as listed } from "./plugin-admin-components.generated";'
    );
    expect(buildComponentImportMap([p])).toContain(
      "export const registeredComponentPaths = listed;"
    );
    expect(buildComponentPathsModule([p])).toContain(
      `export const registeredComponentPaths = ${JSON.stringify(paths)} as const;`
    );
  });

  it("is exported empty by a map that registers nothing", () => {
    expect(componentImportMapPaths([])).toEqual([]);
    expect(buildComponentPathsModule([])).toContain(
      "export const registeredComponentPaths = [] as const;"
    );
  });
});

describe("the map's entries: each component with who declared it and what it is for", () => {
  it("tags every kind of component, naming a widget's id", () => {
    const shop = {
      name: "@acme/shop",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        fieldTypes: [{ type: "color", component: "@acme/shop/admin#Color" }],
        admin: {
          pages: [{ path: "reports", component: "@acme/shop/admin#Reports" }],
          widgets: [
            { id: "acme/old", title: "Old", component: "@acme/shop/admin#Old" },
          ],
          header: { slot: "@acme/shop/admin#Header" },
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

    expect(componentImportMapEntries([shop])).toEqual([
      {
        path: "@acme/shop/admin#Color",
        owner: 'plugin "@acme/shop"',
        use: "field type",
      },
      {
        path: "@acme/shop/admin#Header",
        owner: 'plugin "@acme/shop"',
        use: "slot",
      },
      {
        path: "@acme/shop/admin#Old",
        owner: 'plugin "@acme/shop"',
        use: "widget",
        widget: "acme/old",
      },
      {
        path: "@acme/shop/admin#Reports",
        owner: 'plugin "@acme/shop"',
        use: "page",
      },
      {
        path: "@acme/shop/admin#Revenue",
        owner: 'plugin "@acme/shop"',
        use: "widget",
        widget: "acme/revenue",
      },
    ]);
    // The paths the map registers are the entries' paths, in their order.
    expect(componentImportMapPaths([shop])).toEqual(
      componentImportMapEntries([shop]).map(each => each.path)
    );
  });

  it("keeps the first declaration of a path two plugins share", () => {
    const declaring = (name: string) =>
      ({
        name,
        version: "1.0.0",
        nextly: "*",
        contributes: {
          admin: { pages: [{ path: "x", component: "@shared/admin#Page" }] },
        },
      }) as unknown as PluginDefinition;
    expect(
      componentImportMapEntries([declaring("@a/one"), declaring("@b/two")])
    ).toEqual([
      { path: "@shared/admin#Page", owner: 'plugin "@a/one"', use: "page" },
    ]);
  });

  it("keeps a path as a widget's when a widget uses it after a page does", () => {
    // Declared first as a page, then by a dashboard widget: only a widget's
    // missing component is refused, so the widget's use is the one kept.
    const both = {
      name: "@acme/shop",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        admin: { pages: [{ path: "x", component: "@acme/shop/admin#Shared" }] },
        dashboard: {
          widgets: [
            {
              id: "acme/shared",
              view: { component: "@acme/shop/admin#Shared" },
            },
          ],
        },
      },
    } as unknown as PluginDefinition;
    expect(componentImportMapEntries([both])).toEqual([
      {
        path: "@acme/shop/admin#Shared",
        owner: 'plugin "@acme/shop"',
        use: "widget",
        widget: "acme/shared",
      },
    ]);
  });
});
