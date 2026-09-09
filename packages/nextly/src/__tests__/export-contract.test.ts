import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  WidgetArchetype,
  WidgetHeight,
  WidgetOp,
  WidgetSize,
  WidgetSourceField,
} from "../index";

// The rename is only complete when the old vocabulary is absent from every
// published entry point. A re-exported legacy name is indistinguishable from a
// supported one to anyone reading the package, so the list is spelled out here
// rather than derived: a name that comes back fails this test instead of
// shipping.
const FORBIDDEN = [
  "defineComponent",
  "component",
  "ComponentConfig",
  "ComponentLabel",
  "ComponentAdminOptions",
  "ComponentFieldConfig",
  "isComponentField",
  "validateComponentConfig",
  "assertValidComponentConfig",
  "RESERVED_COMPONENT_SLUGS",
  "MAX_COMPONENT_NESTING_DEPTH",
  "DesiredComponent",
  "dynamicComponents",
  "dynamicComponentsPg",
  "dynamicComponentsMysql",
  "dynamicComponentsSqlite",
  "DynamicComponentRecord",
  "DynamicComponentInsert",
  "ComponentSource",
  "ComponentMigrationStatus",
  "COMPONENT_SOURCE_TYPES",
  "COMPONENT_MIGRATION_STATUSES",
];

/**
 * Names already published from two entry points meaning different things.
 *
 * 🔴 Recorded, not accepted. Each is the same defect `getNextly` was: one name,
 * two functions, and nothing at an import site to say which one arrived.
 * `isFieldGroupType` is a boolean test in one place and a generic narrowing in
 * the other; `createAdapter` is the CLI's and the database factory's, which
 * take different arguments and do different work.
 *
 * They are listed rather than fixed here because each needs the same decision
 * `getNextly` needed about which keeps the name, and answering three of those
 * inside one rename is how a considered API becomes an incidental one. Listing
 * them is what makes a FOURTH fail this test on the day it appears.
 */
const KNOWN_ARITY_CLASHES = [
  "isFieldGroupType: nextly takes 1, nextly/field-group-type takes 2",
  "createAdapter: nextly takes 1, nextly/database takes 1, nextly/cli/utils takes 0",
];

const manifestUrl = new URL("../../package.json", import.meta.url);
const packageRoot = path.dirname(fileURLToPath(manifestUrl));

const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  exports: Record<string, { import: string }>;
};

const declaredSubpaths = Object.keys(manifest.exports);

/**
 * The source module behind a published subpath.
 *
 * 🔴 The mapping is `dist` -> `src` rather than a second hand-kept list, because a hand-kept list is
 * what this suite exists to stop being possible. `package.json` is what a consumer resolves, so it
 * is the only description of the surface that cannot fall behind it.
 */
function sourceOf(distEntry: string): string {
  return path.join(
    packageRoot,
    distEntry.replace(/^\.\/dist\//, "src/").replace(/\.mjs$/, ".ts")
  );
}

const ENTRY_POINTS: Array<[string, string]> = declaredSubpaths.map(subpath => [
  subpath === "." ? "nextly" : `nextly/${subpath.replace(/^\.\//, "")}`,
  sourceOf(manifest.exports[subpath]!.import),
]);

describe("published export surface", () => {
  // 🔴 Guards the derivation, not the package. Every check below is generated from `ENTRY_POINTS`,
  // so a mapping that silently produced fewer entries — or none — would delete its own cases and
  // leave a suite whose every remaining case passes. A vanished test reads exactly like a passing
  // one, so the matrix is asserted against the manifest it claims to describe.
  it("covers every subpath package.json publishes", () => {
    expect(ENTRY_POINTS).toHaveLength(declaredSubpaths.length);
    expect(declaredSubpaths.length).toBeGreaterThan(0);
  });

  // The mapping is textual, so a renamed or moved module would resolve to a path that does not
  // exist. Importing it would throw inside the case that names it, which is legible; a missing file
  // is checked separately so the failure says which of the two happened.
  it.each(ENTRY_POINTS)("%s resolves to a source module", (_name, source) => {
    expect(existsSync(source), `no source module at ${source}`).toBe(true);
  });

  it.each(ENTRY_POINTS)(
    "%s exposes no legacy component names",
    async (_name, source) => {
      const mod = (await import(pathToFileURL(source).href)) as Record<
        string,
        unknown
      >;
      const leaked = FORBIDDEN.filter(name => name in mod);
      expect(leaked).toEqual([]);
    }
  );

  // 🔴 The defect this generalises: `getNextly` was published from `nextly` as
  // an async function taking a required config, and from `nextly/runtime` as a
  // synchronous one taking none. Same name, opposite tolerance for an
  // uninitialised process, and nothing said so at an import site. It cost a
  // wrong example in the package's own JSDoc, a wrong sentence in a test
  // header, and a defensive assertion in the admin's code generator.
  //
  // Arity is the cheap half of a signature and it separates the two cases that
  // matter: a function that demands configuration from one that takes none.
  it("does not publish one name from two entries with different arities", async () => {
    const seen = new Map<string, Array<{ entry: string; arity: number }>>();
    for (const [entry, source] of ENTRY_POINTS) {
      const mod = (await import(pathToFileURL(source).href)) as Record<
        string,
        unknown
      >;
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== "function") continue;
        seen.set(name, [
          ...(seen.get(name) ?? []),
          { entry, arity: value.length },
        ]);
      }
    }
    const clashing = [...seen.entries()]
      .filter(
        ([, places]) =>
          places.length > 1 &&
          new Set(places.map(place => place.arity)).size > 1
      )
      .map(
        ([name, places]) =>
          `${name}: ${places
            .map(place => `${place.entry} takes ${String(place.arity)}`)
            .join(", ")}`
      );
    expect(clashing).toEqual(KNOWN_ARITY_CLASHES);
    // The control: a scan that imported nothing would report no clash. This
    // asserts the scan actually read a surface.
    expect(seen.size).toBeGreaterThan(50);
  });

  it("publishes each way to reach an instance under its own name", async () => {
    // The two are kept apart on purpose. `getNextly` initialises and is correct
    // whether or not the process has booted; `requireNextly` reads what is
    // already registered and throws when there is none.
    const root = (await import("../index")) as Record<string, unknown>;
    const runtime = (await import("../runtime")) as Record<string, unknown>;
    expect(typeof root.getNextly).toBe("function");
    expect(typeof runtime.requireNextly).toBe("function");
    expect("getNextly" in runtime).toBe(false);
    expect("requireNextly" in root).toBe(false);
  });

  it("exposes the field-group vocabulary from the config entry point", async () => {
    // The counterpart to the list above: absence alone would also be satisfied
    // by deleting the API, so the replacements are asserted present.
    const cfg = (await import("../config")) as Record<string, unknown>;
    expect(typeof cfg.defineFieldGroup).toBe("function");
    expect(typeof cfg.fieldGroup).toBe("function");
  });

  it("publishes every contract a widget definition names", async () => {
    // `WidgetDefinition` is exported from the root and its `defaultHeight` is
    // typed `WidgetHeight`. There is no `nextly/widgets` subpath, so the root
    // entry point is the only place a plugin author can reach these -- and a
    // publicly visible property whose type has no public name cannot be
    // annotated, only inferred. Same argument for the source contract:
    // `registerSource` and `WidgetSource` are published, so the field and op
    // vocabularies they are built out of have to be nameable too.
    const root = (await import("../index")) as Record<string, unknown>;
    expect(root.WIDGET_SIZES).toEqual(["sm", "md", "lg", "xl", "full"]);
    expect(root.WIDGET_HEIGHTS).toEqual(["short", "tall"]);
    expect(root.WIDGET_ARCHETYPES).toContain("metric");
    expect(root.WIDGET_SOURCE_KINDS).toContain("collection");
    expect(root.WIDGET_OPS).toContain("count");

    // The types themselves: this file is compiled by `tsconfig.tests.json`, so
    // an unexported name here is a `check-types` failure rather than a silent
    // pass. Each is annotated (never merely inferred), which is the property a
    // plugin author actually needs.
    const height: WidgetHeight = "tall";
    const size: WidgetSize = "lg";
    const archetype: WidgetArchetype = "metric";
    const op: WidgetOp = "count";
    const field: WidgetSourceField = { name: "title", type: "string" };
    expect([height, size, archetype, op, field.name]).toHaveLength(5);
  });

  it("publishes the field-group type accessor", async () => {
    // Named explicitly because the derived matrix would still pass if this subpath were dropped
    // from package.json: the surface would simply be described as smaller. The accessor is the one
    // entry point whose absence sends callers back to reading the raw storage key by hand.
    expect(declaredSubpaths).toContain("./field-group-type");
    const mod = (await import("../field-group-type")) as Record<
      string,
      unknown
    >;
    expect(typeof mod.readFieldGroupType).toBe("function");
    expect(typeof mod.isFieldGroupType).toBe("function");
    expect(typeof mod.writeFieldGroupType).toBe("function");
  });
});
