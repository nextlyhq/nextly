/**
 * The Variables tab's reads through the plugin's variable routes: how widely
 * variables are used, where one is used, and counting the site's pages now.
 * Removing a variable stays a save of the whole tokens section, which the
 * server refuses while a dropped variable is used.
 *
 * The routes' answers are read into the builder's own types here, so the tab
 * knows nothing of the transport.
 *
 * @module @nextlyhq/plugin-page-builder/admin/variables-client
 */
import type {
  VariableReach,
  VariablesAccess,
  VariablesUsage,
  VariableUsesPage,
} from "@nextlyhq/builder/shell";
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useMemo } from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  variableUsagePath,
  variableWhereUsedPath,
  type VariablesUsageResponse,
  type VariableUseItem,
} from "../library-contract";

import {
  documentBuilderPath,
  singleBuilderPath,
} from "./editor/builder-address";
import {
  countSiteUsage,
  usesPageFrom,
  type UsesList,
} from "./shared-styles-client";

/** The usage answer as the tab reads it: each variable's usage by identity. */
function usageFromResponse(
  body: VariablesUsageResponse | undefined
): VariablesUsage {
  if (body === undefined) throw new Error("The usage read answered nothing.");
  // Own entries only, into a Map, so an identity such as `__proto__` is a
  // variable like any other rather than a key of the object's prototype.
  const variables = new Map<string, VariableReach>(
    Object.entries(body.variables)
  );
  return {
    whole: body.whole,
    counting: body.counting,
    mayCount: body.mayCount,
    variables,
  };
}

/**
 * Where a place's Page Builder view opens: a collection's document by its
 * collection and id; a Single's one document, which the route names by the
 * Single's slug with no id, by its slug. Nothing for a shared style, which
 * opens in the Design panel, nor a block type's default style, which has
 * nowhere to open.
 */
function placeAddress(item: VariableUseItem): string | undefined {
  if (item.kind === "shared-style" || item.kind === "block-default") {
    return undefined;
  }
  return item.id === ""
    ? singleBuilderPath(item.collection)
    : documentBuilderPath(item.collection, item.id);
}

/**
 * One where-used page as the tab reads it. A document carries where its Page
 * Builder view opens; a shared style or a block type's default style carries
 * none.
 */
function usesFromResponse(
  body: UsesList<VariableUseItem> | undefined,
  page: number
): VariableUsesPage {
  // No fixed last page: the variables route bounds its list by the places
  // the site has (`variableUsesPagesMax` there), past the shared styles'
  // cap, and says no page follows its last.
  return usesPageFrom(body, { page }, item => {
    const href = placeAddress(item);
    return {
      id: item.id,
      title: item.title,
      // Kept: an id is unique only within its collection.
      collection: item.collection,
      kind: item.kind,
      // A look's block type, which names it with its id.
      ...(item.blockType === undefined ? {} : { blockType: item.blockType }),
      ...(href === undefined ? {} : { href }),
    };
  });
}

/**
 * The variable routes, bound for the tab, with the ways to a shared style
 * or a block look that uses one: `openSharedStyle`, when the host can open
 * Shared styles, and `openLook`, when it can edit a look in the inspector.
 */
export function useVariablesClient(
  openSharedStyle?: (classId: string) => void,
  openLook?: VariablesAccess["openLook"]
): VariablesAccess {
  const usage = useCallback(
    async (ids: readonly string[], signal: AbortSignal) =>
      usageFromResponse(
        await readPluginRoute<VariablesUsageResponse>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: variableUsagePath(ids),
          signal,
        })
      ),
    []
  );

  const uses = useCallback(
    async (id: string, page: number, signal: AbortSignal) =>
      usesFromResponse(
        await readPluginRoute<UsesList<VariableUseItem>>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: variableWhereUsedPath(id, page),
          signal,
        }),
        page
      ),
    []
  );

  return useMemo(
    () => ({
      usage,
      uses,
      // The shared styles' count: one count fills every usage index.
      count: countSiteUsage,
      ...(openSharedStyle === undefined ? {} : { openSharedStyle }),
      ...(openLook === undefined ? {} : { openLook }),
    }),
    [usage, uses, openSharedStyle, openLook]
  );
}
