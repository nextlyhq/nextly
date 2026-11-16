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
} from "../block";
export type {
  AnyBlockDefinition,
  BlockDefinition,
  BlockEditorMeta,
  BlockIcon,
  BlockInspectorProps,
  BlockIsland,
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
  PropSchema,
  SlotLock,
  SlotSpec,
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
  MAX_BLOCK_VERSION,
  registryBlockSource,
  registryLookup,
  registryMigrationSource,
  registryNestingSource,
} from "../registry";
export type { RegisterOptions, SupportDefinition } from "../registry";
