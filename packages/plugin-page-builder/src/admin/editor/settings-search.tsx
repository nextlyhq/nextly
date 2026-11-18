"use client";

/**
 * Where the builder shows the page's search result: in Page settings'
 * General, and in the right panel's page settings. A plugin that edits SEO
 * draws it there, at the Settings place, as a block (`at` says which of the
 * two), so the page's one SEO panel is that plugin's and no second preview
 * of the page can disagree with it. Only where no plugin adds a block does
 * the builder draw its own plain preview, built from the page itself.
 *
 * The builder never decides whether a plugin edits SEO for the page: that
 * is the plugin's to say, by the same rule its SEO tab is drawn by.
 *
 * @module admin/editor/settings-search
 */
import {
  TargetSlot,
  useDocumentLocale,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import type { ReactNode } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  loopCollectionsPath,
  type LoopCollectionsResponse,
} from "../../loop-collections-contract";
import {
  PAGE_BUILDER_SETTINGS_PLACE,
  type PageBuilderSettingsBlockProps,
} from "../../settings-place-contract";
import { loopCollectionsOf } from "../loop-collections-client";

import type { SettingsPlace } from "./settings-place";

/**
 * The page's content type, named for its pages ("Pages"), as the collections
 * the author may read are named; undefined until read, or where it is not
 * among them. The same read the builder opens with, so it asks nothing more.
 */
function useTypePlural(collection: string | undefined): string | undefined {
  const locale = useDocumentLocale()?.code ?? undefined;
  const listed = usePluginRoute<LoopCollectionsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: loopCollectionsPath(locale),
    enabled: collection !== undefined,
  });
  if (collection === undefined) return undefined;
  return loopCollectionsOf(listed.data)?.find(item => item.slug === collection)
    ?.label;
}

/** What a block at the place is handed for the page the place is about. */
function blockPropsOf(
  place: SettingsPlace,
  at: PageBuilderSettingsBlockProps["at"],
  typePlural: string | undefined
): PageBuilderSettingsBlockProps {
  const { control, design, designField } = place.tabProps;
  return {
    at,
    control,
    design,
    ...(designField === undefined ? {} : { designField }),
    ...(typePlural === undefined ? {} : { typePlural }),
  };
}

/**
 * The page's search result where the builder shows it: a plugin's block at
 * the Settings place, or, where none is added, `plain`, the builder's own.
 * A document that offers no place (a component, a Layout) shows `plain`.
 */
export function SearchPlace({
  place,
  at,
  plain,
}: {
  place: SettingsPlace | null;
  at: PageBuilderSettingsBlockProps["at"];
  plain: ReactNode;
}): ReactNode {
  const typePlural = useTypePlural(place?.context?.collection);
  if (place === null) return plain;
  return (
    <TargetSlot
      place={PAGE_BUILDER_SETTINGS_PLACE}
      context={place.context}
      fallback={plain}
      blockProps={blockPropsOf(place, at, typePlural)}
    />
  );
}
