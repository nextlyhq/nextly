/**
 * The classic spacing model reproduces the stylesheet the compiler wrote
 * before container gaps, byte for byte.
 *
 * `__fixtures__/classic-spacing.css` was captured by running that earlier
 * compiler (its blocks-engine and blocks-react sources) on
 * `CLASSIC_SPACING_PAGE`, which holds every block whose spacing moved. An
 * equality pin rather than spot checks: any rule the classic model writes that
 * the old compiler did not, or misses, fails it.
 */
import { readFileSync } from "node:fs";

import type {
  BlockDocument,
  BlockNode,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { CHILD_GAP_CLASS } from "@nextlyhq/blocks-engine";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PageContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver, type BlockResolver } from "../resolver";
import { RichText } from "../rich-text";
import { sharedStyleInputsId } from "../shared-style-inputs";
import { resolvePageStyles } from "../styles";

import {
  CLASSIC_SPACING_BREAKPOINTS,
  CLASSIC_SPACING_PAGE,
} from "./classic-spacing.fixture";
import { coreBlocks } from "./index";

const OLD_CSS = readFileSync(
  new URL("./__fixtures__/classic-spacing.css", import.meta.url),
  "utf8"
);

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};

const context = (
  spacingMode?: StyleCompileContext["spacingMode"]
): StyleCompileContext => ({
  breakpoints: CLASSIC_SPACING_BREAKPOINTS,
  ...(spacingMode === undefined ? {} : { spacingMode }),
});

function compiled(document: BlockDocument, ctx: StyleCompileContext) {
  return resolvePageStyles(document, undefined, ctx, resolver);
}

describe("the classic spacing model", () => {
  it("compiles the stylesheet the compiler before container gaps wrote", () => {
    expect(compiled(CLASSIC_SPACING_PAGE, context("classic")).css).toBe(
      OLD_CSS
    );
  });

  it("is a different sheet from the gaps model, which is the default", () => {
    // The control: the fixture is not simply what every compile writes.
    const gaps = compiled(CLASSIC_SPACING_PAGE, context("gaps"));
    expect(gaps.css).not.toBe(OLD_CSS);
    expect(gaps.css).toContain(`.${CHILD_GAP_CLASS} > * + *`);
    expect(compiled(CLASSIC_SPACING_PAGE, context()).css).toBe(gaps.css);
  });

  it("puts the gap marker on no container", () => {
    const { classes } = compiled(CLASSIC_SPACING_PAGE, context("classic"));
    for (const names of Object.values(classes)) {
      expect(names.split(" ")).not.toContain(CHILD_GAP_CLASS);
    }
  });
});

describe("the spacing model in a stored sheet's stamp", () => {
  it("moves the stamp under classic and leaves the gaps stamp as it was", () => {
    const stamp = (ctx: StyleCompileContext) =>
      sharedStyleInputsId({ ...ctx, elementBases: {} });
    expect(stamp(context("classic"))).not.toBe(stamp(context("gaps")));
    // Absent and `gaps` compile alike, so a sheet stored before the model
    // existed keeps its stamp and is not recompiled for nothing.
    expect(stamp(context("gaps"))).toBe(stamp(context()));
  });

  it("recompiles a sheet stored under the gaps model for a classic site", () => {
    const stored = compiled(CLASSIC_SPACING_PAGE, context("gaps"));
    const served = resolvePageStyles(
      CLASSIC_SPACING_PAGE,
      stored,
      context("classic"),
      resolver
    );
    expect(served.css).toBe(OLD_CSS);
  });
});

describe("markup that differs by spacing model", () => {
  const IMAGE = {
    root: {
      type: "root",
      children: [{ type: "image", src: "/a.png", altText: "A" }],
    },
  };

  it("gives a rich-text image its old vertical margin under classic", () => {
    const classic = renderToStaticMarkup(
      <RichText value={IMAGE} spacingMode="classic" />
    );
    expect(classic).toContain('style="margin:1rem 0"');
    const gaps = renderToStaticMarkup(<RichText value={IMAGE} />);
    expect(gaps).toContain('style="margin-inline:0"');
  });

  it("leaves a collection loop's entries unmarked under classic", async () => {
    // Through the renderer, so the model is read where a page states it and
    // reaches the block the way every render argument does.
    const page: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "loop",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts" },
          slots: {
            children: [
              { id: "t", type: "core/text", version: 1, props: {} },
            ] as BlockNode[],
          },
        } as BlockNode,
      ],
    };
    const ctx = {
      entry: null,
      data: {
        find: () =>
          Promise.resolve({ items: [{ id: "e1" }, { id: "e2" }], total: 2 }),
      },
      resolveMedia: () => Promise.resolve(null),
      resolveEntryPath: () => Promise.resolve(null),
    } as unknown as PageContext;
    const html = async (spacingMode?: "classic") => {
      const stream = await renderToReadableStream(
        <PageRenderer
          document={page}
          blocks={createBlockResolver(coreBlocks)}
          context={ctx}
          styleContext={context(spacingMode)}
        />
      );
      await stream.allReady;
      return new Response(stream).text();
    };
    const entryMarker = `nx-bt-core--collection-loop ${CHILD_GAP_CLASS}`;
    expect(await html()).toContain(entryMarker);
    const classic = await html("classic");
    expect(classic).not.toContain(CHILD_GAP_CLASS);
  });
});
