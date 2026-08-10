/**
 * What the package's entry points actually export.
 *
 * A published changeset once advertised `defineBlock` as a new export while the
 * root entry never re-exported it, so every `import { defineBlock } from
 * "@nextlyhq/blocks-react"` failed to resolve. Nothing caught it: the symbol
 * existed, its own module's tests imported it by relative path, and typechecking
 * a package cannot notice that a public entry omits something.
 *
 * So the entry list is pinned. The value is not the list itself but the failure
 * it forces: adding a symbol to a module no longer silently fails to reach the
 * people the release notes told about it, and removing one from the entry is a
 * deliberate edit here rather than an accident there.
 *
 * Values only. Types are erased before this runs and cannot be enumerated, so
 * they are covered by the compile-time import below instead.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as boundaryModule from "./block-boundary";
import * as blocksEntry from "./blocks/index";
import * as contextModule from "./context";
import * as pageRendererModule from "./page-renderer";
import * as placeholderModule from "./placeholder";
import * as prepareModule from "./prepare-document";
import * as resolverModule from "./resolver";
import * as stylesModule from "./styles";
import * as visibilityModule from "./visibility";
import * as rootEntry from "./index";
import * as nextEntry from "./next";

// Type-only, and the point is that it compiles: the tests project typechecks
// this file, so a type that stops being exported from the root fails the build
// rather than this suite. Without it the pin below would cover values alone.
import type {
  BlockRenderArgs,
  PageContext,
  QueryBudget,
  ReactBlockDefinition,
} from "./index";

/**
 * Whether an exported value is a block definition.
 *
 * Structural rather than an `instanceof`: `defineBlock` returns its argument
 * unchanged, so a definition is a plain object and there is no class to test.
 * The three fields checked are the ones the registry requires.
 */
function isBlockDefinition(
  value: unknown
): value is { name: string; version: number } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.version === "number" &&
    typeof candidate.render === "function"
  );
}

/**
 * Source modules the root entry re-exports from, and the values each one
 * deliberately keeps internal.
 *
 * The snapshot below catches an export REMOVED from the entry. It cannot catch
 * one that never arrived: adding a public value to `context.ts` and forgetting
 * the re-export leaves `Object.keys(rootEntry)` unchanged, and that is exactly
 * the defect this suite was written after.
 *
 * So the entry is compared against its sources. A new public value fails here
 * until it is either re-exported or named below with a reason, which makes
 * withholding one a deliberate act rather than an oversight.
 */
const SOURCE_MODULES: ReadonlyArray<{
  name: string;
  module: Record<string, unknown>;
  /** Values that exist for this package's own use, and why. */
  internal: readonly string[];
}> = [
  { name: "context", module: contextModule, internal: [] },
  { name: "resolver", module: resolverModule, internal: [] },
  {
    name: "styles",
    module: stylesModule,
    // `readableGatedRules` is exported so `page-renderer` reads a stored artifact's gated map
    // through the SAME predicate the delivery uses. They once disagreed — one accepted anything
    // not undefined, the other required a plain record — so a malformed map counted as coverage
    // while going unread, and the stale sheet shipped a hidden block's rules. It crosses a module
    // boundary inside this package; it is not a consumer surface.
    internal: [
      "isRecordedGatedEntry",
      "isUsableGatedEntry",
      "readableGatedRules",
    ],
  },
  {
    name: "visibility",
    module: visibilityModule,
    // `isUnconditional` is the negation of the engine's `isConditionGated`, which
    // `@nextlyhq/blocks-engine` already exports. Publishing a second spelling of one
    // question from a second package is how the compiler and this renderer came to
    // disagree about gating three separate times; the entry offers the PASS a caller
    // actually needs and leaves the predicate with its single owner.
    internal: ["isUnconditional"],
  },
  { name: "placeholder", module: placeholderModule, internal: [] },
  { name: "page-renderer", module: pageRendererModule, internal: [] },
  { name: "prepare-document", module: prepareModule, internal: [] },
  {
    name: "block-boundary",
    module: boundaryModule,
    // The renderer calls these; a consumer composes `PageRenderer` or
    // `BlockList` instead of driving normalization itself.
    internal: ["checkedOutput", "nodeRootReason"],
  },
];

describe("the root entry", () => {
  it("exports exactly these values", () => {
    expect(Object.keys(rootEntry).sort()).toEqual([
      "BlockBoundary",
      "BlockList",
      "BlockPlaceholder",
      "PageRenderer",
      "createBlockResolver",
      "createStandaloneContext",
      "defineBlock",
      "emptyDataProvider",
      "migrationSourceFor",
      "prepareDocumentForRead",
      "pruneHiddenNodes",
      "registeredBlocks",
      "resolvePageStyles",
      "styleTextForInjection",
      "toPageStyles",
    ]);
  });

  it("checks every module the entry re-exports from", () => {
    // The list above is the guard's own coverage, and a guard that covers five
    // of six modules leaves the sixth exactly as exposed as before. Read the
    // entry's own relative imports rather than trusting the list to keep pace.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8"
    );
    const reExported = new Set(
      [...source.matchAll(/from "\.\/([\w-]+)"/g)].map(match => match[1])
    );
    const covered = new Set(SOURCE_MODULES.map(entry => entry.name));

    const uncovered = [...reExported].filter(name => !covered.has(name));
    expect(
      uncovered,
      `index.ts re-exports from ${uncovered.join(", ")}, which SOURCE_MODULES does not check.`
    ).toEqual([]);
  });

  it("re-exports every public value its source modules define", () => {
    // The snapshot above sees an export leaving the entry. This sees one that
    // never reached it, which is the failure that produced this suite: a symbol
    // added to a module, announced in a changeset, and importable by nobody.
    const exported = new Set(Object.keys(rootEntry));

    for (const source of SOURCE_MODULES) {
      const internal = new Set(source.internal);
      const missing = Object.keys(source.module).filter(
        name => !exported.has(name) && !internal.has(name)
      );

      expect(
        missing,
        `${source.name}.ts exports ${missing.join(", ")} but the entry does not. ` +
          `Re-export it, or add it to that module's \`internal\` list with a reason.`
      ).toEqual([]);
    }
  });

  it("offers everything needed to declare a block without a relative import", () => {
    // The three names a block author reaches for. `defineBlock` alone is not
    // enough: hand-rolling a definition, or typing a render function that is
    // written separately from the definition, needs the other two.
    const declared: ReactBlockDefinition<{ value?: string }> = {
      name: "test/entry-surface",
      version: 1,
      description: "Declared through the package entry alone.",
      props: {},
      defaultProps: {},
      example: { props: {} },
      render: ({ className }: BlockRenderArgs<{ value?: string }>) => null,
    };

    expect(rootEntry.defineBlock(declared)).toBe(declared);
  });

  it("keeps a context type reachable for a host wiring one up", () => {
    const context: PageContext = rootEntry.createStandaloneContext();
    expect(context.entry).toBeNull();
  });
});

describe("the blocks entry", () => {
  it("exports the core library and every block in it", () => {
    expect(Object.keys(blocksEntry).sort()).toEqual([
      "BUTTON_TYPES",
      "CONTAINER_TAGS",
      "CONTENT_WIDTH_CLASS",
      "HEADING_LEVELS",
      "IMAGE_LOADING",
      "LIST_KINDS",
      "box",
      "button",
      "collectionLoop",
      "coreBlocks",
      "divider",
      "embed",
      "heading",
      "image",
      "list",
      "paragraph",
      "quote",
      "renderContainer",
      "section",
      "spacer",
    ]);
  });

  it("lists every exported block in coreBlocks", () => {
    // A block exported but left out of the list is registered nowhere, which is
    // the quiet half of the same mistake: the symbol resolves and the block
    // never appears.
    //
    // The exported set is DERIVED rather than listed, so exporting a new block
    // without adding it to `coreBlocks` fails here. Naming one member instead
    // would leave the other eleven unchecked, which is the exact hole this
    // guard exists to close.
    // Widened to `unknown` before the guard runs: the entry's values are a
    // heterogeneous union (definitions, a readonly tag list, a class name, the
    // array itself), and a predicate cannot narrow out of that union directly.
    const exported: string[] = [];
    for (const value of Object.values(blocksEntry)) {
      const candidate: unknown = value;
      if (isBlockDefinition(candidate)) exported.push(candidate.name);
    }
    exported.sort();
    const registered = blocksEntry.coreBlocks.map(block => block.name).sort();

    expect(exported.length).toBeGreaterThan(0);
    expect(registered).toEqual(exported);
    // And no name is registered twice, which would make the comparison above
    // pass while one block shadowed another in the registry.
    expect(new Set(registered).size).toBe(registered.length);
  });
});

describe("the next entry", () => {
  it("exports exactly these values", () => {
    // The route helper joins the entry marker here. Types are erased, so
    // `BlocksPageConfig` and `DerivedPageSeo` never appear in this list — the
    // guard is about what a consumer can CALL.
    expect(Object.keys(nextEntry).sort()).toEqual([
      "BLOCKS_REACT_NEXT_ENTRY",
      "DEFAULT_MAX_QUERIES",
      "createBlocksPage",
    ]);
  });
});
