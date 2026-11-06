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

import { documentBuilderPath } from "./editor/builder-address";
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
 * One where-used page as the tab reads it. A document carries where its Page
 * Builder view opens; a shared style is opened in the Design panel instead,
 * so it carries none.
 */
function usesFromResponse(
  body: UsesList<VariableUseItem> | undefined
): VariableUsesPage {
  return usesPageFrom(body, item => ({
    id: item.id,
    title: item.title,
    // Kept: an id is unique only within its collection.
    collection: item.collection,
    kind: item.kind,
    ...(item.kind === "shared-style"
      ? {}
      : { href: documentBuilderPath(item.collection, item.id) }),
  }));
}

/**
 * The variable routes, bound for the tab, with the way to a shared style
 * that uses one: `openSharedStyle`, when the host can open Shared styles.
 */
export function useVariablesClient(
  openSharedStyle?: (classId: string) => void
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
        })
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
    }),
    [usage, uses, openSharedStyle]
  );
}
