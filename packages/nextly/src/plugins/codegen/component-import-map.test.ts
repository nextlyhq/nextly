import { describe, expect, it } from "vitest";

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
