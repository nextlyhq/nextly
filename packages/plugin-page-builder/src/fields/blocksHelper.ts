/**
 * The `blocks()` field factory.
 *
 * Moved here with the field type it builds. It used to live in
 * `nextly/config` beside the built-in factories, which meant an app could
 * declare a blocks field without installing the plugin that renders it — a
 * field that stored a document and offered no way to edit one.
 *
 * @module fields/blocksHelper
 */

import { pluginField } from "nextly/config";

import type { BlocksFieldConfig } from "./blocks-options";
import { BLOCKS_TYPE } from "./blocksField";

/**
 * Creates a blocks field configuration.
 *
 * The block TYPES a document may use are not declared on the field. They are
 * registered once for the whole app, and a field only narrows which of them it
 * accepts through `blocks.allow`. Declaring block shapes per field would mean
 * the same block described differently in two collections, with no way to
 * migrate either.
 *
 * @example
 * ```ts
 * blocks({ name: "content", blocks: { allow: ["core/*"] } })
 * ```
 */
export const blocks = (config: Omit<BlocksFieldConfig, "type">) =>
  // Marked, so the declaration is admissible where a collection's fields are
  // typed. `FieldConfig` is a closed union of the built-in shapes — which is
  // what makes a malformed built-in a compile error — and a contributed type
  // has no arm in it. The brand opens one deliberately.
  pluginField({ ...config, type: BLOCKS_TYPE });
