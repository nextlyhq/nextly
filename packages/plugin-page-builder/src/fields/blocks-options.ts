/**
 * Blocks Field Type Definitions
 *
 * A blocks field holds one page-builder document: a tree of block nodes with
 * their props, styles, and slots, stored as a single JSON value.
 *
 * The block TYPES a document may use are not declared here. They are
 * registered once for the whole app with `defineBlock`, and a field only
 * narrows which of the registered blocks it will accept. (The plugin
 * contribution key that feeds that registry at boot is not wired yet, so for
 * now `allow` narrows a set nothing has populated.) Declaring block shapes on the field instead would
 * mean the same block described differently in two collections, with no way to
 * migrate either — the reason the field carries an allow-list of names rather
 * than definitions.
 *
 * @module collections/fields/types/blocks
 */

import type { BlockDocument, DocumentKind } from "@nextlyhq/blocks-engine";
// Taken from the SDK rather than the core entry: the SDK is the only import
// surface a plugin author is offered, and a first-party plugin reaching past it
// is the example third parties copy.
import type {
  FieldAdminOptions,
  FieldConfig,
  RequestContext,
} from "@nextlyhq/plugin-sdk";

import type { BLOCKS_TYPE } from "./blocksField";

/**
 * The parts of a field declaration this type adds to.
 *
 * Taken from the published `FieldConfig` union rather than core's internal
 * base interfaces: a plugin authors against the surface core publishes, and
 * reaching into `collections/fields/types/base` would tie this to a module
 * that is not part of the contract.
 */
type BaseFieldConfig = Extract<FieldConfig, { name: string }>;

// Re-exported so the field layer names document kinds without every consumer
// reaching into the engine package.
export type { DocumentKind };

/**
 * The value a blocks field holds: a whole document envelope, not a bare list
 * of nodes. The envelope carries the format version every stored document is
 * migrated from and the kind that says what the document is for, so both
 * travel with the value instead of having to be inferred later.
 */
export type BlocksFieldValue = BlockDocument | null | undefined;

/** Which blocks and which document kinds a field accepts. */
export interface BlocksFieldOptions {
  /**
   * Registered block names this field accepts, e.g. `["core/heading",
   * "core/section"]`. A trailing `*` matches a namespace (`"core/*"`).
   * Omitted means every registered block is allowed.
   */
  allow?: string[];

  /**
   * Document kinds this field accepts. Omitted means `["page"]`: a field on a
   * collection or single holds that entry's own page content. The wider set
   * exists for the builder's own document storage, where patterns, components,
   * regions, and templates live alongside pages.
   */
  kinds?: DocumentKind[];
}

/**
 * Configuration for a blocks field.
 *
 * @example
 * ```typescript
 * const field: BlocksFieldConfig = {
 *   name: 'content',
 *   type: 'blocks',
 *   blocks: { allow: ['core/*'] },
 * };
 * ```
 */
export interface BlocksFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'blocks'.
   */
  type: typeof BLOCKS_TYPE;

  /**
   * Which blocks and document kinds this field accepts.
   */
  blocks?: BlocksFieldOptions;

  /**
   * Default document for a new entry.
   */
  defaultValue?:
    | BlocksFieldValue
    | ((data: Record<string, unknown>) => BlocksFieldValue);

  /**
   * Admin UI configuration.
   */
  admin?: FieldAdminOptions;

  /**
   * Custom validation, run after the document's own structural rules.
   */
  validate?: (
    value: BlocksFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}

/**
 * The options a field declares, as an object.
 *
 * The single reader of `field.blocks`. Both the validator and the admin editor
 * need it, and two readings of one declaration is how a field ends up
 * validated against one policy and edited under another — which is exactly the
 * shape of a document seeded as a `page` into a field that accepts only
 * patterns.
 */
export function blocksOptionsOf(field: unknown): BlocksFieldOptions {
  // `unknown` rather than a shape with one optional key: a parameter whose
  // properties are all optional has nothing in common with a field instance
  // type, so the checker refuses the very callers this exists for.
  const declared = (field as { blocks?: unknown })?.blocks;
  if (typeof declared !== "object" || declared === null) return {};
  // No cast: every property of the options is optional, so the narrowed
  // `object` already satisfies the return type. An assertion here would be
  // stating a fact the checker has, and would keep stating it after the
  // options gain a required member — which is the moment it stops being true.
  return declared;
}

/**
 * Which document kinds a field accepts, or nothing when it says nothing.
 *
 * `undefined` and `["page"]` are not the same answer and are not collapsed
 * here: a field that declares nothing takes the default, and the default is
 * the caller's to apply.
 */
export function acceptedKinds(
  field: unknown
): readonly DocumentKind[] | undefined {
  return blocksOptionsOf(field).kinds;
}
