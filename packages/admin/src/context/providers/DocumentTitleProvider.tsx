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

import {
  NAV_COLLECTIONS_PARAMS,
  useCollection,
  useCollections,
  useCollectionSchema,
} from "@admin/hooks/queries/useCollections";
import {
  NAV_SINGLES_PARAMS,
  useSingles,
  useSingleSchema,
} from "@admin/hooks/queries/useSingles";
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
 * The collection a route opens, from answers the admin already holds.
 *
 * First the sidebar's own collection list, asked with the sidebar's params and
 * so under the sidebar's cache key: the sidebar loads it on every signed-in
 * screen, so this reuses that request rather than adding one. Only asked for
 * on a route that opens a collection.
 *
 * That list is one bounded page, so a site with more collections than it holds
 * falls back to what the screen loaded for itself: the editor and create
 * screens read the collection's schema, the entry list the collection. Both
 * are OBSERVED here, never fetched (`enabled: false`), through the screens'
 * own hooks so the cache keys stay theirs; they fill as the screen's request
 * answers. Until something arrives the tab names the site alone.
 */
function useOpenCollection(slug: string | undefined, opens: boolean) {
  const name = opens ? slug : undefined;
  const { data: listed } = useCollections(NAV_COLLECTIONS_PARAMS, {
    enabled: opens,
  });
  const { data: schema } = useCollectionSchema(name, { enabled: false });
  const { data: detail } = useCollection(name, { enabled: false });
  if (!name) return undefined;
  return listed?.items.find(item => item.name === name) ?? schema ?? detail;
}

/**
 * The Single a route opens: from the sidebar's Single list, else from the
 * schema the Single's screen loaded for itself, observed without fetching, as
 * `useOpenCollection` does for collections.
 */
function useOpenSingle(slug: string | undefined, opens: boolean) {
  const name = opens ? slug : undefined;
  const { data: listed } = useSingles(NAV_SINGLES_PARAMS, { enabled: opens });
  const { data: schema } = useSingleSchema(name, { enabled: false });
  if (!name) return undefined;
  return listed?.items.find(item => item.slug === name) ?? schema;
}

/** The screen's name, reading the open collection or Single on a route that opens one. */
function useScreenName(
  route: RouteResult,
  pathname: string
): string | undefined {
  const slug = route.entityAccess?.slug;
  const collection = useOpenCollection(
    slug,
    route.accessSubject === "collection"
  );
  const single = useOpenSingle(slug, route.accessSubject === "single");
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
