/**
 * @nextlyhq/blocks-engine — the runtime-free core of the Nextly page builder.
 *
 * This package owns the stored document format and the pure operations over
 * it. It never imports React or Nextly at runtime, so documents can be
 * created, inspected, and transformed from any JavaScript environment.
 */
export {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  COMPONENT_INSTANCE_TYPE,
  STYLE_STATES,
  MAX_BREAKPOINTS_PER_AXIS,
  isTokenRef,
  isComponentInstance,
} from "./document";
export type {
  BlockDocument,
  BlockNode,
  Binding,
  BindingSource,
  BindingFormat,
  BreakpointDef,
  BreakpointId,
  BreakpointSet,
  ComponentInstanceProps,
  Condition,
  DocumentFormatVersion,
  DocumentKind,
  DocumentSettings,
  LocaleOverlay,
  LocaleOverlayValue,
  NodeStyles,
  NodeVisibility,
  StyleState,
  StyleValue,
  StyleValues,
  TokenRef,
} from "./document";

export {
  MAX_DEPTH,
  MAX_NODES,
  DEFAULT_MAX_DOCUMENT_BYTES,
  LIMIT_WARNING_RATIO,
  DEFAULT_SLOT,
  DEFAULT_LIMITS,
  countNodes,
  treeDepth,
  documentBytes,
} from "./limits";
export type { DocumentLimits } from "./limits";

export {
  newId,
  makeNode,
  walkNodes,
  findNode,
  locateNode,
  insertNode,
  removeNode,
  moveNode,
  reidSubtree,
  duplicateNode,
  updateNode,
} from "./tree";
export type { NodeLocation, TreePosition } from "./tree";
