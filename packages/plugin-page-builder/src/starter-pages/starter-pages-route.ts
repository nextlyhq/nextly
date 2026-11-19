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

import { starterMisfitSentence, type StarterSite } from "./starter-fit";
import {
  starterItem,
  starterOffers,
  starterPageCopy,
  takesPages,
  type StarterOffer,
} from "./starter-offer";
import type { RegisteredStarterPage } from "./starter-pages";
import { STARTER_PAGES_ROUTE_PATH } from "./starter-pages-contract";

/** The starter pages a page whose field takes `kinds` may start from. */
export interface StarterPagesSource {
  /**
   * Every starter, as the dialog and the empty page list them: one the site
   * can't hold now is listed with why (`unavailable`).
   */
  list(kinds?: readonly DocumentKind[]): Promise<readonly NewPageStarter[]>;
  /**
   * The page body the starter `id` gives a new page, copied with new ids;
   * why the site can't hold it, in the words a refusal says; or `undefined`
   * where no starter has that id.
   */
  copy(
    id: string,
    kinds?: readonly DocumentKind[]
  ): Promise<StarterCopy | undefined>;
}

/** A starter's copy for a new page, or the sentence refusing it. */
export type StarterCopy =
  | { readonly document: BlockDocument }
  | { readonly unavailable: string };

/** What the source reads: this boot's starters and what the site has now. */
export interface StarterPagesDeps {
  /** The starters this boot registered, in order. */
  readonly registered: () => readonly RegisteredStarterPage[];
  /** The site's block registry. */
  readonly blocks: BlockRegistryReader;
  /**
   * What the site defines now, read per call: the identities of its
   * variables and the ids of its shared styles.
   */
  readonly defined: () => Promise<
    Required<Pick<StarterSite, "variables" | "sharedStyles">>
  >;
  /** The bounds a page's document is held to. */
  readonly limits?: DocumentLimits;
}

/** The source the routes answer from. */
export function starterPagesSource(deps: StarterPagesDeps): StarterPagesSource {
  const offered = async (
    kinds: readonly DocumentKind[] | undefined
  ): Promise<StarterOffer[]> => {
    // A field that holds no page (a component store's, a template's) is
    // offered none; nothing else is read for it.
    if (!takesPages(kinds)) return [];
    const registered = deps.registered();
    if (registered.length === 0) return [];
    return starterOffers(
      registered,
      { blocks: deps.blocks, ...(await deps.defined()) },
      deps.limits
    );
  };
  return {
    list: async kinds =>
      (await offered(kinds)).map(offer =>
        starterItem(offer.entry.starter, offer.misfit)
      ),
    copy: async (id, kinds) => {
      const offer = (await offered(kinds)).find(
        candidate => candidate.entry.starter.id === id
      );
      if (offer === undefined) return undefined;
      // Refused in the words the picker showed under it, judged now, since
      // a page made from it could not hold it.
      if (offer.misfit !== undefined) {
        return {
          unavailable: starterMisfitSentence(offer.entry.starter, offer.misfit),
        };
      }
      const document = starterPageCopy(
        offer.entry.starter,
        deps.blocks,
        deps.limits
      );
      return document === undefined ? undefined : { document };
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
