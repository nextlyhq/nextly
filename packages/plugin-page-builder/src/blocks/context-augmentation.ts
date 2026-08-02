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
import type { DataProvider, QueryBudget } from "./context";

declare module "@nextlyhq/plugin-sdk/blocks" {
  interface BlockRenderContext {
    /**
     * Where a block reads content from. Absent when nothing can be queried,
     * which is the editor drawing a block before a source has been chosen.
     */
    data?: DataProvider;
    /**
     * The entry the surrounding repeater is on.
     *
     * Set by a block rendering its slot once per entry, and read by whatever is
     * inside that slot. It lives on the CONTEXT rather than being passed as a
     * prop because a repeater does not know, and should not know, which of its
     * descendants cares: the value flows down to all of them and each takes
     * what it needs.
     */
    item?: Record<string, unknown>;
    /**
     * What is left of this render's query allowance. Absent means the renderer
     * is not counting, which is the editor drawing one block in isolation.
     */
    queries?: QueryBudget;
  }
}
