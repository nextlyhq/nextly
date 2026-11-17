"use client";

/**
 * The Add panel's pictures of saved sections: what each is drawn from, and
 * with what.
 *
 * The builder's picture part draws whatever document it is handed; this
 * decides what that is for a saved section. Its PUBLISHED document, which is
 * what the library hands the panel, drawn with this site's rendering as the
 * editor holds it: the site's style (the same one the canvas draws with), the
 * component definitions the canvas resolves instances against, and the blocks
 * the entry page's miniature draws. In the mode the canvas is previewed in,
 * so a dark preview shows dark pictures.
 *
 * The rendering is compiled against a container of the pictures' own, as the
 * entry page's miniature is: a picture composed at the desktop width answers
 * its responsive rules for that width rather than the admin window's.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/section-pictures
 */
import {
  previewContainerFor,
  type DefinitionsById,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  DocumentMiniature,
  type MiniatureRender,
  type MiniatureSession,
  type PatternInsertEntry,
} from "@nextlyhq/builder/shell";
import { usePluginClientConfig } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useId, useMemo, type ReactNode } from "react";

import { siteSheet, type SiteStyleData } from "../../site-style";
import { entryBlockResolver } from "../entry-block-resolver";
import { pageRenderInputs, readDocumentLimits } from "../page-render-inputs";

import { PLUGIN_SOURCE } from "./stored-document";

/** The icon a saved section's tile shows when its picture can't be drawn. */
const SAVED_SECTION_ICON = "section";

export interface SectionPictureInputs {
  /** The site's style as the canvas draws with it. */
  siteStyle: SiteStyleData | undefined;
  /** The component definitions the canvas resolves instances against. */
  definitions: DefinitionsById;
  /** The mode the canvas is previewed in, or `null` for the page's own. */
  mode: TokenMode | null | undefined;
  /** What the editor's pictures share for as long as it is open. */
  session: MiniatureSession;
}

/** This site's rendering for a picture, compiled once per change of input. */
function usePictureRender(
  siteStyle: SiteStyleData | undefined,
  definitions: DefinitionsById
): MiniatureRender {
  const clientConfig = usePluginClientConfig(PLUGIN_SOURCE);
  const containerId = useId();
  return useMemo(() => {
    const inputs = pageRenderInputs({
      siteStyle,
      clientConfig,
      previewContainer: previewContainerFor(containerId),
      // Unset: a picture shows the section as published, with no class
      // alternative beside each pseudo-class rule.
      limits: readDocumentLimits(clientConfig),
      definitions,
    });
    return {
      ...inputs,
      blocks: entryBlockResolver(),
      siteStyles: siteSheet(siteStyle),
    };
  }, [siteStyle, clientConfig, containerId, definitions]);
}

/**
 * @returns the panel's `renderPicture`: a saved section's picture, drawn from
 *   its published document
 */
export function useSectionPictures({
  siteStyle,
  definitions,
  mode,
  session,
}: SectionPictureInputs): (entry: PatternInsertEntry) => ReactNode {
  const render = usePictureRender(siteStyle, definitions);
  return useCallback(
    (entry: PatternInsertEntry) => (
      <DocumentMiniature
        documents={[entry.document]}
        render={render}
        {...(mode === null || mode === undefined ? {} : { mode })}
        icon={SAVED_SECTION_ICON}
        session={session}
      />
    ),
    [render, mode, session]
  );
}
