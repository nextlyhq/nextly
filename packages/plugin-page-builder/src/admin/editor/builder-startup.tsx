"use client";

/**
 * Where the builder's start-up read is sent: as the editor opens, before any
 * of the reads it stands in for is asked.
 *
 * Drawn just before the editor, so it renders first and the reads the editor
 * asks as it mounts find the start-up read already on its way. It draws
 * nothing, and re-renders on its own when the form's Layout changes, so the
 * editor beside it never renders for it.
 *
 * @module admin/editor/builder-startup
 */
import {
  useCurrentUserId,
  useDocumentLocale,
} from "@nextlyhq/plugin-sdk/admin";
import { useRef } from "react";
import type { Control, FieldValues } from "react-hook-form";

import { PAGE_COLLECTION_ROUTE_PATH } from "../../layout-choices-contract";
import {
  CAPABILITY_ROUTE_PATH,
  componentLibraryPath,
  SITE_STYLE_ROUTE_PATH,
} from "../../library-contract";
import { loopCollectionsPath } from "../../loop-collections-contract";
import { namedQueriesPath } from "../../named-queries-contract";
import { useOpeningLayoutChoicesPath } from "../page-layout";
import { startBuilderReads } from "../startup-reads";

/**
 * The reads the builder opens on, each by the path its own hook asks: in the
 * language being edited, and, on a collection's entry, its pages collection
 * and its Layout choices.
 */
export function builderOpeningReads(
  locale: string | undefined,
  layoutChoices: string | undefined
): string[] {
  return [
    loopCollectionsPath(locale),
    namedQueriesPath(locale),
    componentLibraryPath(locale),
    CAPABILITY_ROUTE_PATH,
    SITE_STYLE_ROUTE_PATH,
    ...(layoutChoices === undefined
      ? []
      : [PAGE_COLLECTION_ROUTE_PATH, layoutChoices]),
  ];
}

/**
 * Send the start-up read once per editor and person, as it opens. A later
 * render, a Layout chosen or a language switched sends nothing: each read
 * asks its own route then, as it always has.
 */
export function BuilderStartup<T extends FieldValues>({
  control,
}: {
  control: Control<T>;
}): null {
  const userId = useCurrentUserId();
  const locale = useDocumentLocale()?.code ?? undefined;
  const choices = useOpeningLayoutChoicesPath(control);
  const sentFor = useRef<string | null | undefined>(undefined);
  if (sentFor.current !== userId) {
    sentFor.current = userId;
    startBuilderReads(userId, builderOpeningReads(locale, choices));
  }
  return null;
}
