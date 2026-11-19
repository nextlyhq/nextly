"use client";

/**
 * The page as the canvas draws it: the definitions it reaches with their
 * conditions lifted, what the renderer is given while conditions are or are
 * not applied, the document and window blocks are drawn in, and the page
 * rendered with the regions of its Layout.
 *
 * @module canvas-drawn-page
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  PageRenderer,
  registeredBlocks,
  type PageRendererProps,
} from "@nextlyhq/blocks-react";
import {
  BlockEnvironmentProvider,
  type BlockEnvironment,
} from "@nextlyhq/blocks-react/environment";
import { useEffect, useMemo, useState } from "react";

import {
  revealedDefinitions,
  revealedForCanvas,
  type AppliedConditions,
} from "../conditions/applied-conditions";
import { withConditionHiddenBlock } from "../conditions/condition-hidden-block";

import { useLayoutParts, type LayoutParts } from "./canvas-layout-parts";
import type { CanvasRegion } from "./canvas-regions";
import { PagePlaceholder } from "./page-placeholder";

// Moved beside `revealedForCanvas`, so a reader with no React (the page
// checks) composes the page from the same definitions; kept importable here.
export { revealedDefinitions } from "../conditions/applied-conditions";

/**
 * The document and window the canvas draws in, held where nothing walking an
 * object's own keys can reach them.
 *
 * The value is a prop of the environment provider, and React's development
 * build describes every changed prop for its performance panel by walking the
 * object's own enumerable keys a few levels down. A plain `{ document, window }`
 * leads that walk into the window, whose own keys include each child frame —
 * and a page with an Embed block has one in an opaque origin, where reading
 * anything throws a `SecurityError`. It threw while React was running the
 * commit's effects, so the effects after it never ran: the canvas stopped
 * measuring its region, and the device and zoom controls stopped moving it.
 *
 * Private fields behind getters are not own enumerable keys, so the walk finds
 * nothing to enter, while `environment.window` reads exactly as before.
 */
class CanvasEnvironment implements BlockEnvironment {
  readonly #document: Document;
  readonly #window: Window;

  constructor(document: Document, view: Window) {
    this.#document = document;
    this.#window = view;
  }

  get document(): Document {
    return this.#document;
  }

  get window(): Window {
    return this.#window;
  }
}

/**
 * The document and window the blocks are drawn in, for block code that
 * measures itself or listens (`useBlockEnvironment`). Read from the canvas
 * root's OWN document rather than the globals, so the answer is the frame's
 * once the canvas renders inside one, with nothing here to change.
 * `undefined` until the root has mounted, which the hook passes on rather
 * than falling back to the admin page. Built as a `CanvasEnvironment` rather
 * than an object literal; see there for why.
 */
export function useCanvasEnvironment(
  root: React.RefObject<HTMLDivElement | null>
): BlockEnvironment | undefined {
  const [environment, setEnvironment] = useState<BlockEnvironment | undefined>(
    undefined
  );
  useEffect(() => {
    const view = root.current?.ownerDocument.defaultView;
    if (root.current === null || view == null) return;
    setEnvironment(new CanvasEnvironment(root.current.ownerDocument, view));
  }, [root]);
  return environment;
}

/**
 * What the canvas renders the page with. Conditions not applied, a placed
 * component's definitions with their conditions lifted, so each conditioned
 * block is drawn. Applied, the definitions as stored, their blocks judged
 * for the previewed entry by the renderer as the page's route judges them
 * (`entryJudged`), and the blocks with the hidden-block marker among them.
 */
function drawnRenderOf(
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  document: BlockDocument,
  applied: AppliedConditions | undefined
): Omit<PageRendererProps, "document" | "siteStyles"> | undefined {
  if (applied === undefined) {
    return rendered?.definitions === undefined
      ? rendered
      : {
          ...rendered,
          definitions: revealedDefinitions(
            document,
            rendered.definitions,
            rendered.limits
          ),
        };
  }
  return {
    ...rendered,
    entryJudged: applied.entryJudgement,
    blocks: withConditionHiddenBlock(rendered?.blocks ?? registeredBlocks()),
  };
}

/**
 * The page, drawn, and the regions of its Layout around it.
 *
 * The parts in drawing order, each with how it treats the site sheet:
 * `undefined` when there are no regions, so a canvas without a Layout renders
 * exactly as it did.
 */
export function useDrawnPage({
  regions,
  rendered,
  sheet,
  document,
  environment,
  applied,
  addressed,
  placeholder,
}: {
  regions: readonly CanvasRegion[] | undefined;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  sheet: NonNullable<PageRendererProps["siteStyles"]>;
  document: BlockDocument;
  environment: BlockEnvironment | undefined;
  applied: AppliedConditions | undefined;
  /**
   * Whether the page's blocks carry their addresses: false while a region of
   * its layout is edited in place, so no surface can find, mark or select a
   * block of the page then, nor take one for the region's block of the same
   * id.
   */
  addressed: boolean;
  /**
   * Words for a grey box drawn after the page, where any page goes, for a
   * document view with no page of its own; absent, none is drawn.
   */
  placeholder?: string | undefined;
}): { drawn: LayoutParts | undefined; page: React.JSX.Element } {
  const drawn = useLayoutParts(regions, rendered, sheet);
  // Every conditioned block drawn, whoever the page would show it to, so the
  // author can see and select it; the marks say it isn't shown to everyone.
  // While conditions are applied, `document` is already the page as they
  // leave it (a hidden block as its marker), with the previewed entry's
  // blocks composed in, which are revealed as they are without conditions.
  // A block a list's entry decides keeps its conditions while the entries
  // are judged, for the renderer to judge against each one drawn.
  const limits = rendered?.limits;
  const drawable = useMemo(
    () => revealedForCanvas(document, applied, limits),
    [document, applied, limits]
  );
  // A placed component's definition too: its conditioned blocks are drawn,
  // as the page's are. While conditions are applied, the renderer also knows
  // the marker a hidden block is drawn as.
  const drawnRender = useMemo(
    () => drawnRenderOf(rendered, document, applied),
    [rendered, document, applied]
  );
  const page = useMemo(
    () => (
      <BlockEnvironmentProvider value={environment}>
        <PageRenderer
          {...drawnRender}
          document={drawable}
          siteStyles={sheet}
          {...drawn?.page}
          // What makes the hit-testing above possible at all. The renderer emits
          // the node attribute only when asked, because a PUBLISHED page should
          // not carry an editor's addressing — so the canvas asks and a route
          // does not. Spread first and set here deliberately: a caller passing
          // `nodeAttribute: false` through `render` would silently disable
          // selection for the whole canvas. Withheld only while a region is
          // edited in place, when the page is not the document being edited.
          nodeAttribute={addressed}
          // What its images and lists drew is kept as it is while it is not
          // addressed, as it is while it is: the node attribute alone would
          // otherwise run them again on every edit in the region.
          {...(addressed ? {} : { keepAsyncOutputs: true })}
        />
        {placeholder === undefined ? null : (
          <PagePlaceholder words={placeholder} />
        )}
      </BlockEnvironmentProvider>
    ),
    [drawnRender, drawable, sheet, environment, drawn, addressed, placeholder]
  );
  return { drawn, page };
}
