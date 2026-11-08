/**
 * The Posts hooks a visual blog runs, registered by a plugin.
 *
 * A code-first blog declares `authorIsCreator` and `bylineFromCreator` on its
 * Posts collection. A visual blog registers no code collections: its Posts
 * comes from the migration's snapshot, which can't hold a function, so a hook
 * declared on the collection never reaches it. A plugin registers hooks by
 * collection slug instead, so `configs/visual.config.ts` lists this one and a
 * new post there is owned by and credited to its writer, as on a code-first
 * blog.
 *
 * Only the hooks travel this way. The field rules that keep a writer from
 * naming another account as a post's `author`, or another profile as its
 * `byline`, are declared on the code-first collection and have no visual
 * counterpart: there the permission alone decides, as it does for editing
 * and deleting (see the README).
 */
import type { PluginDefinition } from "nextly";

import { authorIsCreator } from "./hooks/author-is-creator";
import { bylineFromCreator } from "./hooks/byline-from-creator";

export const postsCreditPlugin: PluginDefinition = {
  name: "blog-posts-credit",
  version: "1.0.0",
  // Shipped inside the site it runs in, so any version of Nextly that site
  // installs is the one it was written for.
  nextly: "*",
  init(ctx) {
    // The phase the code-first collection declares them in, after the
    // validation gate, in the same order.
    ctx.hooks.on("beforeChange", "posts", authorIsCreator);
    ctx.hooks.on("beforeChange", "posts", bylineFromCreator);
  },
};
