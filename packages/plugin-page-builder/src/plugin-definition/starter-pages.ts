/**
 * Starter pages: the boot step that judges them once every block is
 * registered, and the one source the New page read, the create and the
 * starter pages route answer from.
 */
import type { PluginRoute } from "@nextlyhq/plugin-sdk";

import { siteBreakpoints } from "../site-style";
import { FIRST_PARTY_STARTER_PAGES } from "../starter-pages/first-party";
import { registerStarterPagesAtBoot } from "../starter-pages/starter-pages";
import {
  starterPagesRoute,
  starterPagesSource,
  type StarterPagesSource,
} from "../starter-pages/starter-pages-route";

import type { InitContext } from "./install-context";
import type { Definition } from "./state";

/**
 * This boot's starter pages, judged against the blocks registered this
 * boot and the code's breakpoints, into the definition's holder. Throws,
 * naming the starter, for one that is refused, which stops the boot.
 */
export function installStarterPages(ctx: InitContext, def: Definition): void {
  def.state.starterPages = registerStarterPagesAtBoot(
    ctx,
    def.opts,
    FIRST_PARTY_STARTER_PAGES,
    {
      blocks: def.blocks,
      breakpoints: siteBreakpoints(def.configStyle),
      // The bounds a create copies it under, so what boots is what copies.
      ...(def.opts.limits === undefined ? {} : { limits: def.opts.limits }),
    }
  );
}

/**
 * The starters the site offers now: this boot's, less any needing a block,
 * a variable or a shared style the site no longer has. Those are read per call,
 * through the same reading every write is judged by, so a variable removed
 * a moment ago leaves its starters out of the next list.
 */
export function starterPagesOf(def: Definition): StarterPagesSource {
  return starterPagesSource({
    registered: () => def.state.starterPages,
    blocks: def.blocks,
    defined: async () => {
      const read = def.state.composition?.siteDefinitions;
      if (read === undefined) {
        return { variables: new Set(), sharedStyles: new Set() };
      }
      const site = await read();
      return { variables: site.tokenIds, sharedStyles: site.classIds };
    },
    ...(def.opts.limits === undefined ? {} : { limits: def.opts.limits }),
  });
}

/** The route starter pages contribute: the list an empty page shows. */
export function routesForStarterPages(source: StarterPagesSource): {
  readonly starterPages: PluginRoute;
} {
  return { starterPages: starterPagesRoute(source) };
}
