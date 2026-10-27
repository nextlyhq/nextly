"use client";

/**
 * Names the browser tab for the screen on show: "<item> · <screen> · <site>".
 *
 * One writer of `document.title` for the whole admin. The screen's name comes
 * from the route table (`RouteResult.screenName`), the site's from branding
 * (`useAppName`), and the item's from whichever mounted part of the screen
 * called `useDocumentTitle`. Keeping the composition here means no screen sets
 * the title itself, so no screen can leave a stale one behind or restore an old
 * one on unmount: when a screen goes, its item goes from the list and the title
 * is composed again from what remains.
 *
 * @module context/providers/DocumentTitleProvider
 */
import type React from "react";
import {
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { useCollection } from "@admin/hooks/queries/useCollections";
import { useSingleSchema } from "@admin/hooks/queries/useSingles";
import {
  formatDocumentTitle,
  resolveScreenName,
} from "@admin/lib/navigation/screen-names";
import type { RouteResult } from "@admin/lib/routing";

import { useAppName, useBranding } from "./BrandingProvider";

/** How a part of a screen offers, renames and withdraws the item it shows. */
export interface DocumentTitleItems {
  set(id: string, name: string | undefined): void;
  remove(id: string): void;
}

/**
 * Null outside the provider, where `useDocumentTitle` does nothing: a screen
 * rendered on its own (a test, a plugin host) has no admin tab to name.
 */
export const DocumentTitleContext = createContext<DocumentTitleItems | null>(
  null
);

/**
 * The screen's name, reading the open collection or Single when the route
 * opens one. The collection and Single are the answers the content screens
 * already ask for, so on those screens this adds no request of its own; on
 * every other route both queries are disabled.
 */
function useScreenName(
  route: RouteResult,
  pathname: string
): string | undefined {
  const slug = route.entityAccess?.slug;
  const { data: collection } = useCollection(
    route.accessSubject === "collection" ? slug : undefined
  );
  const { data: single } = useSingleSchema(
    route.accessSubject === "single" ? slug : undefined
  );
  const { plugins } = useBranding();
  return resolveScreenName(route.screenName, {
    pathname,
    collection,
    single,
    plugins,
  });
}

/**
 * The item named by the part of the screen mounted LAST that has a name.
 *
 * A Map keeps insertion order and keeps a key's place when its value changes,
 * so a rename does not promote an earlier part over a later one. The latest
 * mounted part is the most specific: a panel opened over a list names the
 * panel's item, and closing it hands the title back to the list.
 */
function latestItem(items: ReadonlyMap<string, string | undefined>) {
  let latest: string | undefined;
  for (const name of items.values()) {
    if (name) latest = name;
  }
  return latest;
}

export function DocumentTitleProvider({
  route,
  pathname,
  children,
}: {
  route: RouteResult;
  pathname: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const screen = useScreenName(route, pathname);
  const site = useAppName();

  // Held in refs and written synchronously, from layout effects, so that a
  // navigation's whole change — the old screen's item withdrawn, the new
  // screen's name in place — lands in one commit, before the browser can show
  // or announce an in-between title.
  const frame = useRef({ screen, site });
  const items = useRef(new Map<string, string | undefined>());

  const write = useCallback(() => {
    document.title = formatDocumentTitle({
      item: latestItem(items.current),
      screen: frame.current.screen,
      site: frame.current.site,
    });
  }, []);

  const registry = useMemo<DocumentTitleItems>(
    () => ({
      set(id, name) {
        items.current.set(id, name);
        write();
      },
      remove(id) {
        items.current.delete(id);
        write();
      },
    }),
    [write]
  );

  useLayoutEffect(() => {
    frame.current = { screen, site };
    write();
  }, [screen, site, write]);

  return (
    <DocumentTitleContext.Provider value={registry}>
      {children}
    </DocumentTitleContext.Provider>
  );
}
