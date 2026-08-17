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

import { accordion } from "./accordion";
import { accordionItem } from "./accordion-item";
import { box } from "./box";
import { button } from "./button";
import { card } from "./card";
import { collectionLoop } from "./collection-loop";
import { column } from "./column";
import { columns } from "./columns";
import { divider } from "./divider";
import { embed } from "./embed";
import { form } from "./form";
import { gallery } from "./gallery";
import { heading } from "./heading";
import { image } from "./image";
import { list } from "./list";
import { paragraph } from "./paragraph";
import { quote } from "./quote";
import { section } from "./section";
import { spacer } from "./spacer";

// `ACCORDION_BLOCK` / `ACCORDION_ITEM_BLOCK` are deliberately NOT re-exported,
// for the reason recorded below for the columns pair: they exist so the two
// halves of the nesting rule name each other without a repeated string literal.
export { accordion } from "./accordion";
export { accordionItem, type AccordionItemProps } from "./accordion-item";
export { box } from "./box";
export { button, BUTTON_TYPES, type ButtonProps } from "./button";
// `CARD_BLOCK` is deliberately NOT re-exported, for the reason recorded below
// for the columns pair: it exists so this block's own tests name it once, which
// is internal coupling rather than a contract a consumer needs.
export { card } from "./card";
export { collectionLoop } from "./collection-loop";
export { column } from "./column";
// `COLUMN_BLOCK` / `COLUMNS_BLOCK` are deliberately NOT re-exported. They exist
// so the two halves of the nesting rule name each other without a repeated
// string literal, which is internal coupling rather than a contract a consumer
// needs. A published constant is a promise to keep it, and this package's entry
// surface is asserted exactly — widening it should buy a caller something.
export { columns } from "./columns";
export { divider, type DividerProps } from "./divider";
export { embed, type EmbedProps } from "./embed";
export {
  form,
  FORM_FIELD_TYPES,
  FORM_METHODS,
  type FormFieldSpec,
  type FormFieldType,
  type FormMethod,
  type FormProps,
} from "./form";
// `GALLERY_BLOCK` / `GALLERY_ITEM_BLOCK` are deliberately NOT re-exported, for
// the reason recorded on the columns pair: they exist so this block names its
// own type and its allowed child once.
export { gallery } from "./gallery";
export {
  heading,
  HEADING_LEVELS,
  type HeadingLevel,
  type HeadingProps,
} from "./heading";
export { image, IMAGE_LOADING, type ImageProps } from "./image";
export { list, LIST_KINDS, type ListProps } from "./list";
export { paragraph, type ParagraphProps } from "./paragraph";
export { quote, type QuoteProps } from "./quote";
export { section } from "./section";
export { spacer, type SpacerProps } from "./spacer";
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
/**
 * The palette's headings and the order they are offered in.
 *
 * Re-exported from the library's own entry because a host that registers these
 * blocks is the same host that ranks their categories, and making it import
 * from two places to do one thing invites the two to be versioned apart.
 */
// Only the ordered list is public. The individual constants are how the block
// files in this directory spell their own category, which is a relative import
// — publishing them too would widen the surface by four names no consumer needs
// and which could then never be renamed.
export { CORE_CATEGORIES } from "./categories";
export type { CoreCategory } from "./categories";

export const coreBlocks = [
  // The comments below record ORDER, which is load-bearing: a resolver built by
  // iterating this list must meet a container before the child whose slot names
  // it. How the library is GROUPED is declared on the blocks themselves, as
  // `editor.category`, because that is where the palette reads it — a second
  // grouping here would agree today and drift silently, with nothing checking
  // either against the other.
  section,
  box,
  // Registered after `columns`, because a row's slot template names the column
  // and a resolver built by iterating this list should meet the parent first.
  columns,
  column,
  card,
  // Parent before child, for the reason recorded on the columns pair: a
  // resolver built by iterating this list should meet the group first.
  accordion,
  accordionItem,
  spacer,
  heading,
  paragraph,
  list,
  image,
  button,
  form,
  // Registered after `image`, the only block its slot allows.
  gallery,
  divider,
  quote,
  embed,
  collectionLoop,
];
