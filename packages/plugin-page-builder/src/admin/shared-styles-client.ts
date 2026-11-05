/**
 * The Shared styles tab's reads and writes through the plugin's shared-style
 * routes: how widely styles are used, where one is used, and locking and
 * removing. Renaming is a write of the site style's classes, which the class
 * surface makes (`useClassSurface`).
 *
 * The route's answers are read into the builder's own types here, so the tab
 * knows nothing of the transport, and a refusal reaches it in the route's own
 * words.
 *
 * @module @nextlyhq/plugin-page-builder/admin/shared-styles-client
 */
import type {
  SharedStyleReach,
  SharedStylesAccess,
  SharedStylesCount,
  SharedStylesUsage,
  SharedStyleUsesPage,
} from "@nextlyhq/builder/shell";
import {
  readPluginRoute,
  validationIssues,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useMemo } from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SHARED_STYLE_COUNT_ROUTE_PATH,
  SHARED_STYLE_IN_USE_CODE,
  SHARED_STYLE_LOCK_ROUTE_PATH,
  SHARED_STYLE_REMOVE_ROUTE_PATH,
  sharedStyleUsagePath,
  sharedStyleWhereUsedPath,
  type SharedStyleLockRequest,
  type SharedStyleRemoveRequest,
  type SharedStylesCountResponse,
  type SharedStylesUsageResponse,
  type SharedStyleUseItem,
} from "../library-contract";

import { refusalWords } from "./site-style-client";
import { useStoredSiteStyle } from "./site-style-read";

/** The usage answer as the tab reads it: each style's usage by id. */
function usageFromResponse(
  body: SharedStylesUsageResponse | undefined
): SharedStylesUsage {
  if (body === undefined) throw new Error("The usage read answered nothing.");
  // Own entries only, into a Map, so an id such as `__proto__` is a style
  // like any other rather than a key of the object's prototype.
  const styles = new Map<string, SharedStyleReach>(Object.entries(body.styles));
  return {
    whole: body.whole,
    counting: body.counting,
    mayLock: body.mayLock,
    mayCount: body.mayCount,
    styles,
  };
}

/** The list envelope the where-used route answers with. */
interface SharedStyleUsesList {
  readonly items: readonly SharedStyleUseItem[];
  readonly meta: {
    readonly total: number;
    readonly hasNext: boolean;
    readonly hiddenCount?: number;
    readonly notConsulted?: readonly string[];
  };
}

/** One where-used page as the tab reads it. */
function usesFromResponse(
  body: SharedStyleUsesList | undefined
): SharedStyleUsesPage {
  if (body === undefined)
    throw new Error("The where-used read answered nothing.");
  return {
    items: body.items.map(item => ({
      id: item.id,
      title: item.title,
      // Kept: an id is unique only within its collection.
      collection: item.collection,
      kind: item.kind,
    })),
    total: body.meta.total,
    hidden: body.meta.hiddenCount ?? 0,
    hasNext: body.meta.hasNext,
    // The route names the documents it could not count while some pages are
    // still being counted, so the list may be short.
    complete: body.meta.notConsulted === undefined,
  };
}

/**
 * The shared-style routes, bound for the tab. A lock or a removal is stored
 * at once, then the site style is read again, so the tab and the canvas draw
 * what was stored.
 */
export function useSharedStylesClient(): SharedStylesAccess {
  const { refetch } = useStoredSiteStyle();

  const usage = useCallback(
    async (ids: readonly string[], signal: AbortSignal) =>
      usageFromResponse(
        await readPluginRoute<SharedStylesUsageResponse>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: sharedStyleUsagePath(ids),
          signal,
        })
      ),
    []
  );

  const uses = useCallback(
    async (id: string, page: number, signal: AbortSignal) =>
      usesFromResponse(
        await readPluginRoute<SharedStyleUsesList>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: sharedStyleWhereUsedPath(id, page),
          signal,
        })
      ),
    []
  );

  /**
   * Send one write; answer what refused it, or read the site style again and
   * answer nothing.
   */
  const send = useCallback(
    async (
      path: string,
      body: SharedStyleLockRequest | SharedStyleRemoveRequest
    ): Promise<{ readonly refused: unknown } | undefined> => {
      try {
        await writePluginRoute({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path,
          body,
        });
      } catch (refused) {
        return { refused };
      }
      await refetch();
      return undefined;
    },
    [refetch]
  );

  const lock = useCallback(
    async (id: string, locked: boolean) => {
      const answer = await send(SHARED_STYLE_LOCK_ROUTE_PATH, {
        classId: id,
        locked,
      });
      return answer === undefined
        ? undefined
        : refusalWords(
            answer.refused,
            locked
              ? "This shared style could not be locked."
              : "This shared style could not be unlocked."
          );
    },
    [send]
  );

  const removeWithReason = useCallback(
    async (ids: readonly string[]) => {
      const answer = await send(SHARED_STYLE_REMOVE_ROUTE_PATH, { ids });
      if (answer === undefined) return undefined;
      return {
        reason: refusalWords(
          answer.refused,
          "These shared styles could not be removed."
        ),
        // The route's in-use refusal names its code, whichever check found
        // the use; a lock or a count no longer whole refuses with another,
        // and says nothing of use.
        inUse: validationIssues(answer.refused).some(
          issue => issue.code === SHARED_STYLE_IN_USE_CODE
        ),
      };
    },
    [send]
  );

  // Counting writes no site style, so nothing is read again here: the tab
  // reads the counts again itself.
  const count = useCallback(async (): Promise<SharedStylesCount> => {
    try {
      // The mutation envelope, `{ message, item }`; the health is its item.
      const answer = await writePluginRoute<{
        readonly item?: SharedStylesCountResponse;
      }>({
        plugin: PAGE_BUILDER_PLUGIN_NAME,
        path: SHARED_STYLE_COUNT_ROUTE_PATH,
        body: {},
      });
      const item = answer?.item;
      if (item === undefined) {
        throw new Error("The count answered without how far it got.");
      }
      return { kind: "counted", whole: item.whole, counting: item.counting };
    } catch (refused) {
      return {
        kind: "refused",
        reason: refusalWords(refused, "The pages could not be counted."),
      };
    }
  }, []);

  // The words alone, as `remove` has always answered.
  const remove = useCallback(
    async (ids: readonly string[]) => (await removeWithReason(ids))?.reason,
    [removeWithReason]
  );

  return useMemo(
    () => ({ usage, uses, lock, remove, removeWithReason, count }),
    [usage, uses, lock, remove, removeWithReason, count]
  );
}
