"use client";

/**
 * Everything the entry screen needs to draw this site's page, as one answer.
 *
 * The resting state has to read four separate things before it can draw a
 * faithful page — the site's style, whether that read has arrived, the site's
 * config, and a container name for its own box — and getting any one of them
 * wrong produces a page that looks right and is not. Assembled inline they were
 * six hooks in a field control whose job is to decide which of two surfaces to
 * render, and the reading of each was easy to get subtly wrong in isolation.
 *
 * Gathered here they are one unit with one contract, and the field asks a
 * question rather than performing a derivation.
 *
 * @module @nextlyhq/plugin-page-builder/admin/use-resting-page-render
 */
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { usePluginClientConfig } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import { siteSheet } from "../site-style";
import { readSiteStyleRecord } from "../site-style-record";

import {
  pageRenderInputs,
  readDocumentLimits,
  type PageRenderInputs,
} from "./page-render-inputs";
import type { SiteStyleState } from "./PageBuilderCard";
import { useSiteStyle } from "./site-style-client";

export interface RestingPageRender {
  /** The site's compiled sheet, as the renderer takes it. */
  siteStyles: PageRendererProps["siteStyles"];
  /** Whether that sheet is usable yet, and why not when it is not. */
  styleState: SiteStyleState;
  /** The rest of this site's rendering, from the derivation the canvas asks. */
  render: PageRenderInputs;
}

/**
 * @param source - the plugin source whose client config carries the settings
 * @returns what the entry screen hands the card
 */
export function useRestingPageRender(source: string): RestingPageRender {
  const clientConfig = usePluginClientConfig(source);

  const configStyle = useMemo(
    () => readSiteStyleRecord(clientConfig?.siteStyle),
    [clientConfig]
  );

  const { siteStyle, pending, error } = useSiteStyle(configStyle);

  const render = useMemo(
    () =>
      pageRenderInputs({
        siteStyle,
        clientConfig,
        // NONE. The card draws the page in a frame with a viewport of its
        // own, so plain `@media` already answers for the composed width — which
        // is what the published page does. A named container here would emit
        // rules whose container is declared nowhere inside that frame.
        previewContainer: undefined,
        // Deliberately unset. This surface shows the page as PUBLISHED, and a
        // class alternative beside each pseudo-class rule would let it paint a
        // hover appearance nobody is causing.
        limits: readDocumentLimits(clientConfig),
      }),
    [siteStyle, clientConfig]
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
    render,
  };
}
