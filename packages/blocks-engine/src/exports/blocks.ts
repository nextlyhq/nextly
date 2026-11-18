/**
 * The engine's public exports: block definitions and the block registry.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
export {
  // The prop an image kept by its address goes to, as a block declares it;
  // public for the editor's unbind and the image renderer alike.
  addressPropOf,
  BLOCK_ICONS,
  defineBlock,
  ITEM_SCHEMA_MAX_DEPTH,
  // What a select's option is called. Public because the builder names a
  // choice with it as the engine's exposure planner does.
  optionLabel,
  // Where a block's setting is edited: the tabs, the Style sections a style
  // setting names, and the one rule placing a prop, which the editor groups
  // its settings by.
  PROP_GROUPS,
  propPlace,
  STYLE_SECTION_KEYS,
} from "../block";
export type {
  AnyBlockDefinition,
  BlockDefinition,
  BlockEditorMeta,
  BlockIcon,
  BlockInspectorProps,
  BlockIsland,
  BlockConversion,
  BlockConversionContext,
  BlockConverter,
  BlockExample,
  BlockSeoContribution,
  BlockSeoRead,
  BlockSeoImage,
  BlockRenderArgs,
  BlockRenderResult,
  BlockSupports,
  BlockSupportValue,
  BlockVariation,
  ComponentPath,
  InferBlockProps,
  PropGroup,
  PropPlace,
  PropSchema,
  SlotLock,
  SlotSpec,
  StyleSectionKey,
} from "../block";

export {
  registerBlocks,
  registerSupport,
  getBlock,
  isBlockName,
  isUsableSlotName,
  hasBlock,
  allBlocks,
  getBlockSource,
  getSupport,
  allSupports,
  clearBlocks,
  createBlockRegistry,
  MAX_BLOCK_VERSION,
  registryBlockSource,
  registryLookup,
  registryMigrationSource,
  registryNestingSource,
} from "../registry";
export type {
  BlockRegistry,
  BlockRegistryReader,
  RegisterOptions,
  SupportDefinition,
} from "../registry";
