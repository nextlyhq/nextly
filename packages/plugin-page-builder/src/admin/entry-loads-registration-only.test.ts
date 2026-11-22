/**
 * Loading the admin entry runs the registration and nothing heavier.
 *
 * The app's generated component map imports this entry with the admin's
 * first load, so whatever the entry imports eagerly every admin screen
 * downloads, the sign-in page included. The editor, the block engine with
 * its CSS parser and the editor stylesheet belong to the parts that draw
 * them, fetched when one of those parts opens.
 *
 * Observed rather than read from the source: each heavy module is wrapped so
 * that importing it records the import, then the entry is imported. A static
 * reading of the imports would have to tell type-only imports from value
 * ones and follow every module in between; this asks the module loader,
 * which does both.
 *
 * The SDK's admin surface is a stand-in holding the calls the registration
 * makes. The real one loads the admin and `nextly/config`, which import the
 * block engine for the admin's own use; what this file judges is the
 * plugin's own graph. The control proves the recording works, through the
 * registration the entry must make.
 *
 * @module admin/entry-loads-registration-only.test
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const imported = vi.hoisted(() => new Set<string>());

/** Wraps a module so that importing it records `name`. */
function recorded(name: string) {
  return async (importOriginal: () => Promise<unknown>) => {
    imported.add(name);
    return importOriginal();
  };
}

vi.mock("@nextlyhq/builder", recorded("@nextlyhq/builder"));
vi.mock("@nextlyhq/builder/ops", recorded("@nextlyhq/builder/ops"));
vi.mock("@nextlyhq/builder/shell", recorded("@nextlyhq/builder/shell"));
vi.mock("@nextlyhq/blocks-engine", recorded("@nextlyhq/blocks-engine"));
vi.mock("@nextlyhq/blocks-react", recorded("@nextlyhq/blocks-react"));
vi.mock(
  "@nextlyhq/blocks-react/blocks",
  recorded("@nextlyhq/blocks-react/blocks")
);
vi.mock("@nextlyhq/blocks-react/next", recorded("@nextlyhq/blocks-react/next"));
vi.mock("css-tree", recorded("css-tree"));
vi.mock("parse5", recorded("parse5"));
vi.mock("../styles/editor.css", () => {
  imported.add("editor.css");
  return {};
});

const registered = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@nextlyhq/plugin-sdk/admin", () => {
  const surface: Record<string, unknown> = {
    registerComponents: (components: Record<string, unknown>) => {
      for (const [path, component] of Object.entries(components)) {
        registered.set(path, component);
      }
    },
    // Read as a list when a module loads; every other name is a function.
    WEB_FONT_FORMATS: [],
  };
  // Any other name the plugin imports: a plugin module that reaches for one
  // as it loads must still load, so the heavy imports after it are recorded
  // rather than hidden behind a missing name.
  // `then` stays absent, or the module would read as a promise.
  const stoodIn = (name: string | symbol): name is string =>
    typeof name === "string" && name !== "then" && !(name in surface);
  return new Proxy(surface, {
    has: (target, name) => stoodIn(name) || name in target,
    get: (target, name) =>
      stoodIn(name) ? vi.fn() : Reflect.get(target, name),
  });
});

/** What the entry must not load as it registers. */
const HEAVY = [
  "@nextlyhq/builder",
  "@nextlyhq/builder/ops",
  "@nextlyhq/builder/shell",
  "@nextlyhq/blocks-engine",
  "@nextlyhq/blocks-react",
  "@nextlyhq/blocks-react/blocks",
  "@nextlyhq/blocks-react/next",
  "css-tree",
  "parse5",
  "editor.css",
];

// One import for the whole file: a module imported once is not imported
// again, so a second import would record nothing and pass either way.
// With the entry, the parts a screen that is not the builder's may draw at
// once: the header's delete tools for a host's own component store (every
// admin page) and the dashboard's card. Each is fetched on first draw, so
// what they load reaches those screens too.
beforeAll(async () => {
  await import("./index");
  await import("./DeleteComponentAction");
  await import("./bindings-report/BindingsToFixCard");
});

describe("the admin entry, and the parts drawn on screens other than the builder's", () => {
  it("load no part of the editor, the block engine or the editor stylesheet", () => {
    expect(HEAVY.filter(name => imported.has(name))).toEqual([]);
  });

  it("CONTROL: registers the blocks field and the builder, ready to draw", () => {
    for (const path of [
      "@nextlyhq/plugin-page-builder/admin#BlocksField",
      "@nextlyhq/plugin-page-builder/admin#PageBuilderView",
    ]) {
      expect(typeof registered.get(path)).toBe("function");
    }
  });

  it("neither exports nor registers the old read-only blocks summary", async () => {
    // The blocks field's card draws what the field holds, so the summary kept
    // for an old component path is gone, with its path.
    const entry: Record<string, unknown> = await import("./index");
    expect("BlocksSummary" in entry).toBe(false);
    expect(
      registered.has("@nextlyhq/plugin-page-builder/admin#BlocksSummary")
    ).toBe(false);
  });
});
