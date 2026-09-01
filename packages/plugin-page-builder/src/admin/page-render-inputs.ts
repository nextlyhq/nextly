/**
 * What a surface has to hand `PageRenderer` to draw THIS site's page.
 *
 * Two surfaces draw the same document — the editing canvas and the entry
 * screen's miniature — and both are claiming to show what a visitor gets. Every
 * input below is one a published route supplies and a surface that omits it
 * renders something plausible and wrong: the wrong breakpoint rules, a remote
 * host the site does not load from, a document repaired under caps the site
 * never chose.
 *
 * Derived once here and asked by both, rather than assembled separately at each
 * call site. Two derivations of one question agree on the day they are written
 * and drift silently afterwards — and the drift is invisible, because a surface
 * missing an input renders a page that looks entirely reasonable.
 *
 * ## What is NOT here
 *
 * `context` — the media resolver and data provider. Neither surface supplies
 * one today, so both fall back to `createStandaloneContext()`, whose media
 * resolver answers `null`: a `core/image` holding a media id draws nothing in
 * the canvas and nothing in the miniature, while the published page shows it.
 * That is a real gap and it is the SAME gap on both surfaces, so closing it
 * belongs to whoever gives the admin a read-only render context — not to a
 * bundle whose job is to keep the two in step.
 *
 * @module @nextlyhq/plugin-page-builder/admin/page-render-inputs
 */
import {
  DEFAULT_LIMITS,
  isPlainRecord,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
// `offeredTiers` is the editor's own answer to "which tiers can a box be sized
// to". Asked rather than re-derived: a second reading of the same breakpoint
// set is a second chance to disagree about whether a container is worth naming.
import { offeredTiers } from "@nextlyhq/builder/shell";

import { readRemotePatterns } from "../host-policy";
import { siteBreakpoints, type SiteStyleData } from "../site-style";

/**
 * The subset of `PageRenderer`'s props this derives.
 *
 * `styleContext` is REQUIRED rather than optional, unlike on the renderer.
 * Callers read `styleContext.breakpoints` back out to decide which tier an edit
 * lands in, and an optional slot there would make every one of those reads a
 * null check for a value this function always produces.
 */
export interface PageRenderInputs {
  styleContext: NonNullable<PageRendererProps["styleContext"]>;
  hostPolicy?: PageRendererProps["hostPolicy"];
  limits?: PageRendererProps["limits"];
}

export interface PageRenderInputsOptions {
  /** The site's resolved style, which is where the breakpoints come from. */
  siteStyle: SiteStyleData | undefined;
  /** The plugin's serialized client config, carrying patterns and limits. */
  clientConfig: Record<string, unknown> | undefined;
  /**
   * The container name the sheet is compiled against, or `undefined` to compile
   * none.
   *
   * A page's responsive rules are `@media` queries, and `@media` asks the
   * WINDOW — so a box laid out at a width the window does not have gets the
   * window's tier rather than its own. Compiling against a named container is
   * what lets a box answer for its own width, and it only works when the
   * element also declares `container-name` and `container-type`; a named
   * container left at the default `normal` is not a size-query container and
   * every rule the compile emitted stays inert.
   */
  previewContainer: string | undefined;
  /**
   * Whether to emit a class alternative beside each pseudo-class rule.
   *
   * An EDITOR concern. A page cannot force `:hover` on itself, so the canvas
   * needs a class it can add to show an author the state they are editing. A
   * surface showing the page AS PUBLISHED wants no such thing — the extra rules
   * would let it paint a hover appearance no visitor is seeing.
   */
  previewStates?: boolean;
  /** The site's document caps, already read from the config. */
  limits: DocumentLimits;
}

/**
 * The renderer inputs for one surface drawing this site's page.
 *
 * @param options - the site's style, its config, and the surface's own choices
 * @returns the `PageRenderer` props that describe this site's rendering
 */
export function pageRenderInputs({
  siteStyle,
  clientConfig,
  previewContainer,
  previewStates,
  limits,
}: PageRenderInputsOptions): PageRenderInputs {
  /*
   * ONE read of the breakpoints, feeding both the compile and the decision
   * about whether a container is worth naming. Two calls return equal sets
   * today and would stop the day `siteBreakpoints` normalises or defaults
   * anything — and then eligibility would answer from a different set than the
   * sheet was compiled against.
   */
  const breakpoints = siteBreakpoints(siteStyle);
  const remotePatterns = readRemotePatterns(clientConfig?.remotePatterns);

  return {
    styleContext: {
      breakpoints,
      /*
       * Named only where there are tiers to simulate. A site defining none has
       * no width-dependent rules, so a container would compile nothing and the
       * element would carry a name answering for nothing.
       */
      ...(previewContainer === undefined ||
      offeredTiers(breakpoints).length === 0
        ? {}
        : { previewContainer }),
      ...(previewStates === true ? { previewStates: true } : {}),
    },
    /*
     * ABSENT is not the same as empty here, and the difference is the whole
     * point of `readRemotePatterns`. An omitted policy leaves remote fetching
     * OPEN, so a surface that forgets it can request an image or an iframe from
     * a host the published page refuses — and `inert` does not prevent a
     * resource load. An empty allowlist, by contrast, refuses every remote
     * host. Only a site that stated patterns gets a policy.
     */
    ...(remotePatterns === undefined ? {} : { hostPolicy: { remotePatterns } }),
    /*
     * The caps the document is repaired against before anything walks it. A
     * site that RAISED a bound has legitimate tail nodes truncated when this is
     * omitted; a site that LOWERED one previews nodes its published page
     * refuses.
     */
    limits,
  };
}

/**
 * The document bounds the host renders under, as published to the browser.
 *
 * Read DEFENSIVELY and one key at a time: `clientConfig` is JSON that crossed a
 * transport, so nothing here can assume a shape. Anything unreadable falls back
 * to the engine's defaults, which is what the renderer itself falls back to —
 * so the two still agree rather than diverging in the direction that would
 * misreport which classes a page applies.
 */
export function readDocumentLimits(
  clientConfig: Record<string, unknown> | undefined
): DocumentLimits {
  const declared = clientConfig?.limits;
  if (!isPlainRecord(declared)) return DEFAULT_LIMITS;
  // Built by overriding the defaults key by key rather than by asserting a
  // shape onto the transported value: the keys come from `DEFAULT_LIMITS`, so
  // a bound the engine adds later is carried without this being edited, and a
  // key the host sent that the engine does not have is ignored.
  const merged: DocumentLimits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof DocumentLimits)[]) {
    const supplied = declared[key];
    /*
     * Zero and Infinity are both LEGITIMATE bounds, so neither may be narrowed
     * away here. A host setting `maxNodes: 0` gets a renderer that draws
     * nothing, and substituting the default would have the panel mark classes
     * as present on a page that renders none of them; the engine supports an
     * infinite byte limit outright. What is refused is a value that is not a
     * number, or one below zero, which no bound can mean.
     */
    // `null` is the wire spelling for an INFINITE bound: `Infinity` is not a
    // JSON value and the client config is refused unless it survives the round
    // trip unchanged, so the publisher encodes it and this decodes it.
    if (supplied === null) {
      merged[key] = Number.POSITIVE_INFINITY;
      continue;
    }
    if (
      typeof supplied === "number" &&
      !Number.isNaN(supplied) &&
      supplied >= 0
    ) {
      merged[key] = supplied;
    }
  }
  return merged;
}
