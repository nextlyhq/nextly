/**
 * The core block library.
 *
 * These live beside the renderer rather than inside the page-builder plugin,
 * and the move is a layering decision rather than tidying. A block definition
 * needs the document model and React and nothing else; the plugin peers the
 * admin and the CMS runtime. Blocks kept there could only be used by a host
 * that has both, which contradicts the renderer's own promise that a document
 * renders standalone. The layering test enforces the direction: a block that
 * reaches for the plugin, the admin, or `next/*` fails the suite.
 *
 * They import `defineBlock` from the ENGINE, not from `@nextlyhq/plugin-sdk`.
 * The engine is where the contract is declared; the SDK re-exports it as the
 * stable surface offered to plugin authors. First-party blocks have no reason
 * to route through a package whose purpose is to be a third party's import.
 *
 * Each block names {@link PageContext} explicitly instead of relying on the
 * module augmentation the plugin used. That augmentation cannot be published
 * (the declaration bundler resolves imports with a scheme older than `exports`
 * maps, so an augmentation naming a subpath is invisible to it), which meant
 * blocks compiled in-repo were typed and blocks compiled against the published
 * types were not. Naming the context is one word longer and always true.
 *
 * @module blocks
 */

import { box } from "./box";
import { collectionLoop } from "./collection-loop";
import { section } from "./section";

export { box } from "./box";
export { collectionLoop } from "./collection-loop";
export { section } from "./section";
export {
  CONTAINER_TAGS,
  CONTENT_WIDTH_CLASS,
  renderContainer,
  type ContainerProps,
  type ContainerTag,
} from "./container";
export type { CollectionLoopProps } from "./collection-loop";

/**
 * Every block in the core library.
 *
 * A list rather than a registry so the caller decides what registering means:
 * the renderer builds a resolver from it, the plugin hands it to the editor's
 * own registration service, and a test can take a subset. Exported as a plain
 * array because that is the shape both of those want.
 */
export const coreBlocks = [box, collectionLoop, section];
