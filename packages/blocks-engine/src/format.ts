/**
 * The document format's constants, with nothing behind them.
 *
 * The package root re-exports the whole engine — validator, migrations, style
 * compiler — and the style compiler carries a CSS parser. A consumer that only
 * needs to know which document kinds exist, or how deep a document may nest,
 * pays for all of it: importing four constants through the root barrel grew one
 * dependent's bundle from 53,685 to 204,524 bytes, none of it reachable.
 *
 * This entry point exists so that cost is opt-in. It re-exports values that are
 * plain data and pulls in no parser, no validator and no compiler, so a
 * generator, a schema publisher or an agent can read the format's vocabulary
 * without loading the machinery that enforces it.
 *
 * **Nothing here may import anything with a runtime dependency.** The whole
 * value of the entry point is what it does NOT reach, and one convenient import
 * would undo it silently — the bundle grows, and nothing fails.
 *
 * @module format
 */

export {
  BINDING_FORMAT_TYPES,
  BINDING_SOURCES,
  type BindingFormatType,
  type BindingSource,
  COMPONENT_INSTANCE_TYPE,
  type ComponentInstanceProps,
  DEFAULT_BINDING_SOURCE,
  isBindingSource,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  type DocumentFormatVersion,
  type DocumentKind,
  STYLE_STATES,
  type StyleState,
} from "./document";

export {
  DEFAULT_MAX_DOCUMENT_BYTES,
  MAX_DEPTH,
  MAX_NODES,
  documentBytes,
} from "./limits";

export { measureBytes } from "./measure-bytes";
export { isPlainRecord } from "./plain-record";

export {
  RESERVED_OPERATION_NAMES,
  isReservedOperationName,
  type ReservedOperationName,
} from "./operations";
