"use client";

/**
 * The built-in colours every colour picker in the editor leaves out while
 * the site hides the ones it does not use, provided once around the shell:
 * the inspector's pickers sit away from the Design panel's Colours tab, so
 * they read the builder's one rule from here rather than from the tab.
 *
 * Hidden means unused by anything the site stores (the variable usage
 * routes) and by the open page with its header and footer as the editor
 * holds them, so a colour placed on the canvas is offered again at once.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/hidden-colours
 */
import {
  resolveSiteTokens,
  type ComponentLookup,
} from "@nextlyhq/blocks-engine";
import { HiddenColours, useHiddenColoursRead } from "@nextlyhq/builder/shell";
import { useMemo, type ReactNode } from "react";

import { useVariablesClient } from "../variables-client";

import type { EditorView } from "./editor-view";
import { offerableTokens } from "./site-style-studios";
import { usedOnPage } from "./used-on-page";

/** No components, for a region that reaches none. */
const NO_COMPONENTS: ComponentLookup = new Map();

/** What the provider reads from the editor's view. */
type HiddenColoursView = Pick<
  EditorView,
  | "editor"
  | "componentLibrary"
  | "canvasRegions"
  | "documentLimits"
  | "canvasSiteStyle"
  | "siteStylePending"
  | "siteStyleError"
  | "configSiteStyle"
  | "classes"
>;

/** Provides the colours the editor's pickers leave out, around `children`. */
export function EditorHiddenColours({
  view,
  children,
}: {
  view: HiddenColoursView;
  children: ReactNode;
}): React.JSX.Element {
  const tokens = offerableTokens(
    view.canvasSiteStyle,
    view.siteStylePending,
    view.siteStyleError
  );
  const hiding = tokens?.builtInColoursShown === false;
  // Resolved as the canvas resolves them, so a `var()` naming a built-in
  // colour is read as a use of it.
  const resolved = useMemo(
    () => (tokens === undefined ? undefined : resolveSiteTokens(tokens)),
    [tokens]
  );
  const configTokens = view.configSiteStyle?.tokens;
  const supplied = useMemo(
    () => resolveSiteTokens(configTokens),
    [configTokens]
  );
  const access = useVariablesClient();
  const { document } = view.editor;
  const definitions = view.componentLibrary.definitions;
  const regions = view.canvasRegions;
  const limits = view.documentLimits;
  const classes = view.classes.library;
  // Walked only while the site hides colours: otherwise nothing reads it.
  const onPage = useMemo(
    () =>
      hiding
        ? usedOnPage(
            [
              { document, components: definitions },
              ...regions.map(region => ({
                document: region.document,
                components: region.definitions ?? NO_COMPONENTS,
              })),
            ],
            limits,
            resolved,
            classes
          )
        : undefined,
    [hiding, document, definitions, regions, limits, resolved, classes]
  );
  const hidden = useHiddenColoursRead({
    tokens,
    supplied,
    access,
    usedOnPage: onPage,
  });
  return (
    <HiddenColours.Provider value={hidden}>{children}</HiddenColours.Provider>
  );
}
