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

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

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
  type: "blocks";

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
