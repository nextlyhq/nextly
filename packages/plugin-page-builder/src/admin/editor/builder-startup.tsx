"use client";

/**
 * Where the builder's start-up read is sent: as the editor opens, before any
 * of the reads it stands in for is asked.
 *
 * Drawn just before the editor, so it renders first and the reads the editor
 * asks as it mounts find the start-up read already on its way. It draws
 * nothing.
 *
 * @module admin/editor/builder-startup
 */
import {
  useCurrentUserId,
  useDocumentIdentity,
  useDocumentLocale,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef } from "react";

import { PAGE_COLLECTION_ROUTE_PATH } from "../../layout-choices-contract";
import {
  CAPABILITY_ROUTE_PATH,
  SITE_STYLE_ROUTE_PATH,
} from "../../library-contract";
import { loopCollectionsPath } from "../../loop-collections-contract";
import { namedQueriesPath } from "../../named-queries-contract";
import { holdStartedReads, startBuilderReads } from "../startup-reads";

/**
 * The reads the builder opens on, each by the path its own hook asks: in the
 * language being edited, and, on a collection's entry, its pages collection.
 * The component library and the Layout choices are read on their own.
 */
function builderOpeningReads(
  locale: string | undefined,
  onCollection: boolean
): string[] {
  return [
    loopCollectionsPath(locale),
    namedQueriesPath(locale),
    CAPABILITY_ROUTE_PATH,
    SITE_STYLE_ROUTE_PATH,
    ...(onCollection ? [PAGE_COLLECTION_ROUTE_PATH] : []),
  ];
}

/**
 * Send the start-up read once per editor and person, as it opens. A later
 * render or a language switched sends nothing: each read asks its own route
 * then, as it always has. Closing the editor drops what it read.
 */
export function BuilderStartup(): null {
  const userId = useCurrentUserId();
  const locale = useDocumentLocale()?.code ?? undefined;
  const onCollection = useDocumentIdentity()?.kind === "collection";
  const sentFor = useRef<string | null | undefined>(undefined);
  if (sentFor.current !== userId) {
    sentFor.current = userId;
    startBuilderReads(userId, builderOpeningReads(locale, onCollection));
  }
  useEffect(() => holdStartedReads(), []);
  return null;
}
