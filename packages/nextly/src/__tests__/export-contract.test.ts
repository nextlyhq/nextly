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
 * What a published function looks like from an import site.
 *
 * Arity and whether it is async, because those are the two halves a caller has
 * to get right and the two the collision this guards against differed in.
 */
function shapeOf(value: (...args: unknown[]) => unknown): string {
  const kind = value.constructor.name === "AsyncFunction" ? "async" : "sync";
  return `${kind}/${String(value.length)}`;
}

/** Names published from more than one entry point with more than one shape. */
function namesPublishedTwice(
  surfaces: Map<string, Record<string, unknown>>
): string[] {
  const seen = new Map<string, Array<{ entry: string; shape: string }>>();
  for (const [entry, mod] of surfaces) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "function") continue;
      seen.set(name, [
        ...(seen.get(name) ?? []),
        { entry, shape: shapeOf(value as (...args: unknown[]) => unknown) },
      ]);
    }
  }
  return [...seen.entries()]
    .filter(
      ([, places]) =>
        places.length > 1 && new Set(places.map(p => p.shape)).size > 1
    )
    .map(
      ([name, places]) =>
        `${name}: ${places.map(p => `${p.entry} ${p.shape}`).join(", ")}`
    );
}

/**
 * Names published from two entry points meaning different things.
 *
 * 🔴 EMPTY, and that is the point. It held the two this check found when it was
 * written, `isFieldGroupType` and `createAdapter`, each recorded rather than
 * fixed because each needed the decision `getNextly` needed about which keeps
 * the name. Both have now been made, so nothing is exempt and the next one
 * fails on the day it appears rather than joining a list.
 *
 * Add to this only to record a clash somebody has decided to keep, with the
 * reason. A name added here to make a red test green is the defect being
 * written down instead of fixed.
 */
const KNOWN_SHAPE_CLASHES: string[] = [];

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
  // uninitialised process, and nothing said so at an import site.
  //
  // Arity alone cannot separate that pair, which is worth stating because the
  // first version of this test used it and would have passed with the defect
  // reinstated: an optional TypeScript parameter is still a declared JavaScript
  // parameter, so `getNextly(options)` and `getNextly(config?)` both report a
  // `length` of 1. Whether the function is async is the half that separates
  // them, and `namesPublishedTwice` compares both.
  it("does not publish one name from two entries with different shapes", async () => {
    const surfaces = new Map<string, Record<string, unknown>>();
    for (const [entry, source] of ENTRY_POINTS) {
      surfaces.set(
        entry,
        (await import(pathToFileURL(source).href)) as Record<string, unknown>
      );
    }
    expect(namesPublishedTwice(surfaces)).toEqual(KNOWN_SHAPE_CLASHES);
    // The control: a scan that imported nothing would report no clash. This
    // asserts the scan actually read a surface.
    expect(surfaces.size).toEqual(ENTRY_POINTS.length);
  });

  it("catches the pair it was written for", () => {
    // The control the first version of this check lacked. These are the two
    // real shapes, and putting them back under one name has to be reported.
    const reinstated = new Map<string, Record<string, unknown>>([
      ["nextly", { getNextly: async (options: unknown) => options }],
      ["nextly/runtime", { getNextly: (config: unknown) => config }],
    ]);
    expect(namesPublishedTwice(reinstated)).toEqual([
      "getNextly: nextly async/1, nextly/runtime sync/1",
    ]);
    // And the other direction: one name, one shape, published twice is a
    // re-export rather than a collision.
    const reexported = new Map<string, Record<string, unknown>>([
      ["nextly", { shared: (a: unknown) => a }],
      ["nextly/runtime", { shared: (a: unknown) => a }],
    ]);
    expect(namesPublishedTwice(reexported)).toEqual([]);
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

  /**
   * The names a resolved clash left behind, asserted where they were promised.
   *
   * An empty {@link KNOWN_SHAPE_CLASHES} says only that no name is published
   * twice with different shapes. Deleting `isFieldGroupFieldType` outright
   * satisfies that too, and so does dropping `createCliAdapter`: the collision
   * is gone either way, and a rename that quietly became a deletion reads as a
   * pass.
   *
   * So each is asserted at the entry it was moved TO. A rename is a promise
   * about where a caller finds the function afterwards, and that is the half an
   * absence check cannot make.
   */
  it("keeps the names the resolved clashes were renamed to", async () => {
    const root = (await import("../index")) as Record<string, unknown>;
    expect(typeof root.isFieldGroupFieldType).toBe("function");

    const fieldGroupType = (await import("../field-group-type")) as Record<
      string,
      unknown
    >;
    expect(typeof fieldGroupType.isFieldGroupFieldType).toBe("function");

    const cli = (await import("../cli/utils")) as Record<string, unknown>;
    expect(typeof cli.createCliAdapter).toBe("function");

    const database = (await import("../database")) as Record<string, unknown>;
    expect(typeof database.createAdapter).toBe("function");

    // The root re-exports the database factory, so `createAdapter` is expected
    // HERE and is the same function `nextly/database` publishes. That pair was
    // never the clash: they agreed. The CLI's was the odd one, and the other
    // half of the promise is that its old spelling has not come back.
    expect(root.createAdapter).toBe(database.createAdapter);
    expect(cli.createAdapter).toBeUndefined();
  });
});
