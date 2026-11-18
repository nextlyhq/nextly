/**
 * The starter pages a site offers, as the routes read them: the list the
 * New page dialog and the empty page's "or start from a page" row show, and
 * the page body a starter gives a new page.
 *
 * Both are answered from one source, so a starter left out of the list (the
 * site no longer has a block or a variable it needs) is one a create refuses
 * too, and a page is only ever made from a starter the author could see.
 *
 * @module starter-pages/starter-pages-route
 */
import type {
  BlockDocument,
  BlockRegistryReader,
  DocumentKind,
  DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { respondList, type PluginRouteContext } from "@nextlyhq/plugin-sdk";

import { onePage } from "../loop-collections-route";
import type { NewPageStarter } from "../pages-write-contract";

import {
  offeredStarterPages,
  starterItem,
  starterPageCopy,
  takesPages,
} from "./starter-offer";
import type { RegisteredStarterPage } from "./starter-pages";
import { STARTER_PAGES_ROUTE_PATH } from "./starter-pages-contract";

/** The starter pages a page whose field takes `kinds` may start from. */
export interface StarterPagesSource {
  /** The starters offered now, as the dialog and the empty page list them. */
  list(kinds?: readonly DocumentKind[]): Promise<readonly NewPageStarter[]>;
  /**
   * The page body the starter `id` gives a new page, copied with new ids,
   * or `undefined` where it isn't offered now.
   */
  copy(
    id: string,
    kinds?: readonly DocumentKind[]
  ): Promise<BlockDocument | undefined>;
}

/** What the source reads: this boot's starters and what the site has now. */
export interface StarterPagesDeps {
  /** The starters this boot registered, in order. */
  readonly registered: () => readonly RegisteredStarterPage[];
  /** The site's block registry. */
  readonly blocks: BlockRegistryReader;
  /** The identities of every variable the site defines now, read per call. */
  readonly variables: () => Promise<ReadonlySet<string>>;
  /** The bounds a page's document is held to. */
  readonly limits?: DocumentLimits;
}

/** The source the routes answer from. */
export function starterPagesSource(deps: StarterPagesDeps): StarterPagesSource {
  const offered = async (
    kinds: readonly DocumentKind[] | undefined
  ): Promise<RegisteredStarterPage[]> => {
    // A field that holds no page (a component store's, a template's) is
    // offered none; nothing else is read for it.
    if (!takesPages(kinds)) return [];
    const registered = deps.registered();
    if (registered.length === 0) return [];
    return offeredStarterPages(registered, {
      blocks: deps.blocks,
      variables: await deps.variables(),
    });
  };
  return {
    list: async kinds =>
      (await offered(kinds)).map(entry => starterItem(entry.starter)),
    copy: async (id, kinds) => {
      const entry = (await offered(kinds)).find(
        candidate => candidate.starter.id === id
      );
      return entry === undefined
        ? undefined
        : starterPageCopy(entry.starter, deps.blocks, deps.limits);
    },
  };
}

/**
 * The route declaration: the starter pages the site offers now, for a page.
 * Authenticated (no `public: true`) with no permission of its own, as the
 * named queries route is: a starter is the site's code, which any editor
 * may see listed, and it reads no entry. Making a page from one is the
 * pages route's create, judged by core as the author.
 */
export function starterPagesRoute(source: StarterPagesSource): {
  method: "GET";
  siteWide: false;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: STARTER_PAGES_ROUTE_PATH,
    siteWide: false, // Acts on no site content; signing in is enough.
    handler: async () => {
      const items = await source.list();
      return respondList([...items], onePage(items.length));
    },
  };
}
