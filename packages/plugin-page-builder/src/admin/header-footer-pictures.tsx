"use client";

/**
 * The header & footer menu's pictures: each set drawn small, its header above
 * its footer, from its PUBLISHED regions, with the same part and the same
 * rendering as the Add panel's saved section pictures, so a picture looks the
 * same wherever one is chosen.
 *
 * A region is drawn as the canvas draws it: one component instance, resolved
 * against the published definitions the choices read sent. Until the read
 * holding a set's definitions has arrived its picture is a quiet placeholder,
 * never the broken-picture icon a missing definition would draw.
 *
 * @module admin/header-footer-pictures
 */
import {
  regionDocument,
  type BlockDocument,
  type LayoutRegion,
} from "@nextlyhq/blocks-engine";
import {
  DocumentMiniature,
  useMiniatureSession,
} from "@nextlyhq/builder/shell";
import { usePluginClientConfig } from "@nextlyhq/plugin-sdk/admin";
import { Skeleton } from "@nextlyhq/ui";
import { useCallback, useMemo, useRef, type ReactNode } from "react";

import { readSiteStyleRecord } from "../site-style-record";

import { usePictureContext } from "./editor/canvas-page-context";
import { usePictureRender } from "./editor/section-pictures";
import { PLUGIN_SOURCE } from "./editor/stored-document";
import { useSiteStyle } from "./site-style-client";

/** The icon a set's picture shows when it can't be drawn. */
const SET_ICON = "section";

/**
 * A picture of some documents, drawn small from the published definitions
 * they reach, with the part and rendering the Add panel's saved section
 * pictures use: a set's regions, or a template's document. Until those
 * definitions have arrived a picture is a quiet placeholder, never the
 * broken-picture icon a missing definition would draw.
 *
 * @param definitions - the published definitions, by component id
 * @param complete - whether those hold every drawn document's, so one not
 *   among them is missing rather than still on its way
 */
export function useDocumentPictures(
  definitions: Readonly<Record<string, BlockDocument>>,
  complete: boolean
): (documents: readonly BlockDocument[], waiting?: boolean) => ReactNode {
  const clientConfig = usePluginClientConfig(PLUGIN_SOURCE);
  const configStyle = useMemo(
    () => readSiteStyleRecord(clientConfig?.siteStyle),
    [clientConfig]
  );
  // The site's stored style, as a visitor's page is drawn with it.
  const { siteStyle } = useSiteStyle(configStyle);
  const byId = useMemo(
    () => new Map(Object.entries(definitions)),
    [definitions]
  );
  const render = usePictureRender(siteStyle, byId);
  const session = useMiniatureSession(usePictureContext());
  return useCallback(
    (documents: readonly BlockDocument[], waiting = !complete) => {
      if (waiting) return <Skeleton className="h-full w-full rounded-sm" />;
      return (
        <DocumentMiniature
          documents={documents}
          render={render}
          icon={SET_ICON}
          session={session}
        />
      );
    },
    [complete, render, session]
  );
}

/**
 * @param definitions - the published definitions the choices read sent, by
 *   component id
 * @param complete - whether those hold every listed set's, so a region whose
 *   component is not among them is missing rather than still on its way
 * @returns a set's picture, from its published regions
 */
export function useSetPictures(
  definitions: Readonly<Record<string, BlockDocument>>,
  complete: boolean
): (picture: readonly LayoutRegion[]) => ReactNode {
  const draw = useDocumentPictures(definitions, complete);
  // One document per region for as long as the menu is mounted: a picture is
  // drawn once and found again by its document, so the same region must be
  // the same object from one render to the next.
  const documents = useRef(new Map<string, BlockDocument>());
  const documentOf = useCallback((region: LayoutRegion): BlockDocument => {
    const key = `${region.area}:${region.componentId}`;
    const known = documents.current.get(key);
    if (known !== undefined) return known;
    const made = regionDocument([region]);
    documents.current.set(key, made);
    return made;
  }, []);
  return useCallback(
    (picture: readonly LayoutRegion[]) =>
      draw(
        picture.map(documentOf),
        !complete &&
          picture.some(region => !(region.componentId in definitions))
      ),
    [complete, definitions, draw, documentOf]
  );
}
