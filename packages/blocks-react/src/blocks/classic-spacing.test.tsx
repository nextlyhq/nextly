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

const CAPTURED_CSS = readFileSync(
  new URL("./__fixtures__/classic-spacing.css", import.meta.url),
  "utf8"
);

/** The accordion's rule as the earlier compiler wrote it. */
const CAPTURED_ACCORDION =
  ".nx-pb-page :where(.nx-bt-core--accordion) { display: grid; gap: var(--site-space-4) }";

/**
 * The captured sheet with the one addition made since, stated here rather
 * than edited into the capture, which stays what the earlier compiler wrote.
 * An accordion's sections now draw an empty icon beside their titles, and a
 * classic site's accordion keeps the browser's marker: its icon choice is
 * Browser default, which keeps the summary as the browser draws it, hides
 * that icon and keeps a title on the marker's line, with the position a new
 * accordion has for an icon chosen later; and a section's title
 * takes the section's own typography, which a text title already did. The
 * page looks as it did.
 */
const OLD_CSS = CAPTURED_CSS.replace(
  CAPTURED_ACCORDION,
  [
    ".nx-pb-page :where(.nx-bt-core--accordion) { --nx-pb-disclosure-icon: browser; --nx-pb-disclosure-position: after; display: grid; gap: var(--site-space-4) }",
    ".nx-pb-page :where(.nx-bt-core--accordion > details > summary) { display: revert; list-style: revert }",
    ".nx-pb-page :where(.nx-bt-core--accordion > details > summary > .nx-pb-disclosure-icon) { display: none; order: 1; margin-inline-start: auto }",
    ".nx-pb-page :where(.nx-bt-core--accordion > details > summary > .nx-pb-disclosure-title) { display: inline }",
    ".nx-pb-page :where(.nx-bp-core--accordion-item--title) { font-size: inherit; font-weight: inherit; line-height: inherit; margin-block-end: 0; margin-block-start: 0; margin-inline-end: 0; margin-inline-start: 0 }",
  ].join("\n")
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
  it("states its addition over the capture, which still holds the rule it replaces", () => {
    // A replace that matched nothing would leave the capture as the pin.
    expect(CAPTURED_CSS).toContain(CAPTURED_ACCORDION);
    expect(OLD_CSS).not.toBe(CAPTURED_CSS);
  });

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

describe("a host's own definition under a core name", () => {
  it("keeps its own defaults under the classic model", () => {
    const own = (name: string, padding: string) => {
      const library = coreBlocks.find(block => block.name === name);
      return {
        ...library,
        baseStyles: {
          base: {
            base: {
              padding: {
                blockStart: padding,
                blockEnd: padding,
                inlineStart: padding,
                inlineEnd: padding,
              },
            },
          },
        },
      } as NonNullable<typeof library>;
    };
    const replaced: BlockResolver = createBlockResolver([
      ...coreBlocks,
      own("core/card", "7px"),
      own("core/section", "9px"),
    ]);
    const css = resolvePageStyles(
      CLASSIC_SPACING_PAGE,
      undefined,
      context("classic"),
      replaced
    ).css;
    expect(css).toContain(":where(.nx-bt-core--card) { padding-block-end: 7px");
    expect(css).toContain(
      ":where(.nx-bt-core--section) { padding-block-end: 9px"
    );
    // The library's own definitions beside them still take the frozen table.
    expect(css).toContain(
      ":where(.nx-bt-core--button) { background-color: var(--site-color-primary); border-style: none; border-block-end-width: 0; border-block-start-width: 0; border-inline-end-width: 0; border-inline-start-width: 0; border-radius: 8px; box-sizing: border-box; color: var(--site-color-background); display: inline-block; font-family: inherit; font-size: inherit; font-style: inherit; font-weight: inherit; letter-spacing: inherit; line-height: inherit; padding-block-end: 0.5rem"
    );
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
