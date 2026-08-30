import { describe, expect, it } from "vitest";

import { buildPluginAdminMeta, type PluginAdminMeta } from "../admin-meta";
import type { PluginDefinition } from "../plugin-context";
import {
  buildComponentImportMap,
  buildImportMapArtifact,
  collectAdminComponentPaths,
  collectBlockEditorComponentPaths,
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
    expect(code).toContain("export {};");
    expect(code).not.toContain("registerComponents");
  });
});

describe("buildImportMapArtifact", () => {
  it("returns the map placed alongside the generated types file", () => {
    const p = plugin({ settings: { component: "@acme/x/admin#Settings" } });
    const artifact = buildImportMapArtifact([p], "./src/types/nextly-types.ts");

    expect(artifact).not.toBeNull();
    expect(artifact?.path.replace(/\\/g, "/")).toMatch(
      /src\/types\/plugin-admin-imports\.generated\.ts$/
    );
    expect(artifact?.code).toContain("registerComponents");
  });

  it("returns null when no plugin contributes admin components", () => {
    const p = plugin({ menu: [{ label: "X", to: "/x" }] }); // menu has no component
    expect(buildImportMapArtifact([p], "./types.ts")).toBeNull();
    expect(buildImportMapArtifact([], "./types.ts")).toBeNull();
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
    // Blocks alone are enough to need the file; returning null here would leave
    // a contributed inspector unloadable.
    const artifact = buildImportMapArtifact(
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

    expect(artifact).not.toBeNull();
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
      buildImportMapArtifact([p], "./src/types/nextly-types.ts")
    ).not.toBeNull();
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
  /** Widget component paths (custom archetype only): deliberately NOT imported. */
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
    // `component` is optional on a widget (required only for
    // `archetype: "custom"`, checked at registration rather than by the
    // type), so a data-archetype widget contributes nothing here.
    widgets: (meta.widgets ?? [])
      .map(widget => widget.component)
      .filter((path): path is string => Boolean(path)),
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
          widgets: [{ id: "stats", component: "@acme/x/admin#StatsWidget" }],
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

    // Widget components are excluded from the STATIC import map on purpose:
    // they are `archetype: "custom"` only, resolved through the same
    // string-path registry pages/settings/fieldTypes use, not pre-bundled
    // ahead of time. Asserted rather than left to a fixture that happens to
    // declare none.
    expect(exposed.widgets).toEqual(["@acme/x/admin#StatsWidget"]);
    expect(collected.has("@acme/x/admin#StatsWidget")).toBe(false);

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
