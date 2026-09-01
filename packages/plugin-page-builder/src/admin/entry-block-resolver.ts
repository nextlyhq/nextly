/**
 * Where the entry screen's miniature gets its block definitions.
 *
 * `PageRenderer` defaults to the process registry, and on the entry screen that
 * registry is EMPTY. `ensureCoreBlocksRegistered()` is called inside
 * `BlocksEditor` and nowhere else, deliberately — the field control renders on
 * every entry form holding a blocks field, whether or not the editor is ever
 * opened, so registering from there would do global work for a form that may
 * never need it.
 *
 * That decision is worth keeping, so this resolves without it. Passing
 * `PageRenderer` an explicit `blocks` resolver costs nothing globally: no
 * registration happens, no side effect outlives the render, and the reason
 * recorded at the `ensureCoreBlocksRegistered` call site stays true.
 *
 * ## The registry is still asked FIRST
 *
 * A host may register its own definition for a type — including a replacement
 * for a core one — and that answer must win wherever it exists. `coreBlocks` is
 * the floor underneath, not an override on top. Anything neither defines
 * resolves to `undefined`, which is what `PageRenderer` already draws a
 * `BlockPlaceholder` for; a page using a block this admin has never heard of
 * therefore reports that honestly rather than rendering a gap.
 *
 * ## A function, not a captured value
 *
 * The same reason `registeredBlocks()` is one: the registry is cleared and
 * rebuilt on a dev-server hot reload, so a resolver holding a snapshot would
 * keep serving definitions the boot has already replaced.
 *
 * @module @nextlyhq/plugin-page-builder/admin/entry-block-resolver
 */
import { getBlock } from "@nextlyhq/blocks-engine";
import type { BlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

/**
 * The core set, indexed once at module load.
 *
 * Safe to capture where the registry is not: `coreBlocks` is a static import
 * whose contents cannot change at runtime, so there is no boot to fall behind.
 */
const CORE_BY_NAME = new Map(coreBlocks.map(block => [block.name, block]));

/**
 * A resolver that answers on the entry screen, where nothing is registered.
 *
 * @returns a resolver preferring a registered definition, falling back to core
 */
export function entryBlockResolver(): BlockResolver {
  return { get: type => getBlock(type) ?? CORE_BY_NAME.get(type) };
}
