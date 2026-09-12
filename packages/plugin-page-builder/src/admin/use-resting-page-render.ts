"use client";

/**
 * Everything the entry screen needs to draw this site's page, as one answer.
 *
 * The resting state has to read five separate things before it can draw a
 * faithful page — the site's style, whether that read has arrived, the site's
 * config, a container name for its own box, and the component definitions its
 * instances resolve against — and getting any one of them wrong produces a
 * page that looks right and is not. Assembled inline they were six hooks in a
 * field control whose job is to decide which of two surfaces to render, and
 * the reading of each was easy to get subtly wrong in isolation. The fifth was
 * simply missing: a component placed in the editor drew on the canvas and
 * became the could-not-be-loaded marker in the miniature the moment the editor
 * closed.
 *
 * Gathered here they are one unit with one contract, and the field asks a
 * question rather than performing a derivation.
 *
 * @module @nextlyhq/plugin-page-builder/admin/use-resting-page-render
 */
import {
  componentUsageIn,
  previewContainerFor,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { usePluginClientConfig } from "@nextlyhq/plugin-sdk/admin";
import { useId, useMemo } from "react";

import { siteSheet } from "../site-style";
import { readSiteStyleRecord } from "../site-style-record";

import {
  useComponentLibrary,
  type ComponentLibraryState,
} from "./component-library-client";
import {
  pageRenderInputs,
  readDocumentLimits,
  type PageRenderInputs,
} from "./page-render-inputs";
import type { SiteStyleState } from "./PageBuilderCard";
import { useSiteStyle } from "./site-style-client";

/**
 * Whether a resting document needs this site's component definitions.
 *
 * A page that places no instance resolves nothing against them, so the
 * miniature is identical without them — and this surface is every entry form
 * holding a blocks field, while the read is the whole component tier: one
 * listing over every row, a read of its own per row to reach the working
 * draft, bounded at sixteen mebibytes.
 *
 * An UNREAD prefix counts as placing one. A document past the site's node cap
 * answers `complete: false`, and "names nothing" is what an unread document
 * looks like too — so the read is made, and the miniature draws what it drew
 * before rather than a page of could-not-be-loaded markers.
 *
 * Exported for its own test: the cap-cut case needs a cap it can reach, and
 * the site's is thousands of nodes.
 */
export function placesComponents(
  document: BlockDocument,
  maxNodes: number
): boolean {
  const usage = componentUsageIn(document.nodes, maxNodes);
  return !usage.complete || usage.ids.length > 0;
}

export interface RestingPageRender {
  /** The site's compiled sheet, as the renderer takes it. */
  siteStyles: PageRendererProps["siteStyles"];
  /** Whether that sheet is usable yet, and why not when it is not. */
  styleState: SiteStyleState;
  /** Whether the component definitions are usable yet, and the way to ask again. */
  components: { state: ComponentLibraryState; retry: () => void };
  /** The rest of this site's rendering, from the derivation the canvas asks. */
  render: PageRenderInputs;
}

/**
 * @param source - the plugin source whose client config carries the settings
 * @param document - the page this draws, which decides whether the component
 *   tier is read at all
 * @returns what the entry screen hands the card
 */
export function useRestingPageRender(
  source: string,
  document: BlockDocument
): RestingPageRender {
  const clientConfig = usePluginClientConfig(source);

  const configStyle = useMemo(
    () => readSiteStyleRecord(clientConfig?.siteStyle),
    [clientConfig]
  );

  const { siteStyle, pending, error } = useSiteStyle(configStyle);

  /*
   * A container name for THIS field's box.
   *
   * From `useId` rather than the field's path: two blocks fields on one form
   * would otherwise compile against one name, and a name is what a container
   * query resolves by — so the second box would answer to the first one's
   * width.
   */
  const containerId = useId();
  const previewContainer = useMemo(
    () => previewContainerFor(containerId),
    [containerId]
  );

  /*
   * The same read the editor makes, so the two share one cache entry, and at
   * the same DRAFT posture: the miniature shows the author their own page, and
   * the component they are mid-edit on is the one they expect to see in it.
   *
   * Asked only for a document that PLACES one. The read is the whole tier —
   * one listing plus a read per component, bounded at sixteen mebibytes — and
   * it was made on every mount of every entry form holding a blocks field,
   * including the ones whose page holds no instance to resolve.
   */
  const limits = useMemo(
    () => readDocumentLimits(clientConfig),
    [clientConfig]
  );
  const library = useComponentLibrary({
    enabled: useMemo(
      () => placesComponents(document, limits.maxNodes),
      [document, limits.maxNodes]
    ),
  });
  const { definitions } = library;

  const render = useMemo(
    () =>
      pageRenderInputs({
        siteStyle,
        clientConfig,
        previewContainer,
        // Deliberately unset. This surface shows the page as PUBLISHED, and a
        // class alternative beside each pseudo-class rule would let it paint a
        // hover appearance nobody is causing.
        limits,
        definitions,
      }),
    [siteStyle, clientConfig, previewContainer, limits, definitions]
  );

  return {
    siteStyles: siteSheet(siteStyle),
    /*
     * Three states, because the third is the one that gets folded into the good
     * one by accident. On a FAILED read `pending` goes false and `siteStyle`
     * resolves to the config defaults, so a caller keyed on `pending` alone
     * draws a page missing this site's stored classes, tokens and block
     * defaults — and looks entirely correct doing it.
     *
     * `!== null`, not `!== undefined`: `useSiteStyle` types the field as
     * `Error | null` and normalises success to `null`, so the `undefined`
     * comparison is true on success too.
     */
    styleState: pending ? "pending" : error !== null ? "unavailable" : "ready",
    // The same three states the read already names, and the retry it holds.
    components: { state: library.state, retry: library.retry },
    render,
  };
}
