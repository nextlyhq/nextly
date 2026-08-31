/**
 * The widget domain's public surface.
 *
 * @module domains/widgets
 */

export {
  WIDGET_SIZES,
  WIDGET_HEIGHTS,
  WIDGET_ARCHETYPES,
  validateWidgetDefinition,
  type WidgetDefinition,
  type WidgetSize,
  type WidgetHeight,
  type WidgetArchetype,
} from "./definition";
export {
  MAX_WIDGET_LIMIT,
  validateWidgetQuery,
  readWidgetQuery,
  resolveWidgetSource,
  validateReadWidgetQuery,
  type RawWidgetQuery,
  type WidgetQuery,
} from "./query";
export {
  WIDGET_OPS,
  WIDGET_SOURCE_KINDS,
  WIDGET_SOURCE_FIELD_TYPES,
  registerSource,
  replaceSourcesOfKind,
  getSource,
  sourceTarget,
  listSources,
  clearSources,
  type WidgetSource,
  type WidgetSourceField,
  type WidgetSourceFieldType,
  type WidgetSourceKind,
  type WidgetOp,
} from "./sources";
export {
  registerWidget,
  overrideWidget,
  extendWidget,
  deregisterWidget,
  getWidget,
  listWidgets,
  widgetSource,
  clearWidgets,
  type WidgetPatch,
} from "./registry";
export { MAX_QUERIES_PER_REQUEST } from "./batch-limit";
export { executeWidgetQuery, type WidgetResult } from "./execute";
export {
  registerBuiltInSources,
  type WidgetSourceCollection,
} from "./built-in-sources";
export { refreshCollectionSources } from "./collection-sources";
