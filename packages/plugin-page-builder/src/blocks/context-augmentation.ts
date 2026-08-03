/**
 * What this renderer adds to every block's context.
 *
 * Kept apart from the declarations it names so the rest of `context.ts` can be
 * re-exported from this package's published entry. A module augmentation has to
 * NAME the module it augments, and the declaration bundler that produces the
 * published types resolves imports itself, with a resolution that predates
 * package `exports` maps — so a subpath such as `@nextlyhq/plugin-sdk/blocks`
 * is invisible to it and pulling this file into the published graph fails the
 * build outright.
 *
 * The consequence is worth stating plainly: blocks compiled from this
 * repository, which is every block that ships today, get the augmented context;
 * an author compiling against the PUBLISHED types names `DataProvider` and its
 * siblings themselves. Closing that needs a hand-authored declaration wired
 * into the exports map, which is a packaging change rather than a block one.
 *
 * @module blocks/context-augmentation
 */
import type { PageContext } from "./context";

declare module "@nextlyhq/plugin-sdk/blocks" {
  interface BlockRenderContext {
    // Each member's TYPE comes from `PageContext`, so the shape is written
    // once. Only the names are repeated, and a type test holds the two key sets
    // equal so a member added to one and not the other fails to compile.
    data?: PageContext["data"];
    item?: PageContext["item"];
    queries?: PageContext["queries"];
  }
}
