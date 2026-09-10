/**
 * The widget domain's public surface.
 *
 * @module domains/widgets
 */

export {
  WIDGET_SIZES,
  WIDGET_CHROME,
  WIDGET_HEIGHTS,
  WIDGET_ARCHETYPES,
  DATA_ARCHETYPES,
  QUERYLESS_ARCHETYPES,
  CELL_ARCHETYPES,
  MAX_STAT_CELLS,
  validateWidgetDefinition,
  type WidgetDefinition,
  type WidgetAction,
  type WidgetSetting,
  type WidgetStatCell,
  type WidgetSize,
  type WidgetChrome,
  type WidgetHeight,
  type WidgetArchetype,
  type DataWidgetArchetype,
  type QuerylessWidgetArchetype,
  type CellWidgetArchetype,
} from "./definition";
// The lifecycle vocabulary travels with the two fields that name it. A closed
// set an author cannot import is one they must retype as a literal, and a
// retyped set is a copy that stops matching the day a condition is added.
export {
  WIDGET_LIFECYCLES,
  WIDGET_CONDITIONS,
  type WidgetLifecycle,
  type WidgetCondition,
} from "./lifecycle";
export {
  MAX_WIDGET_LIMIT,
  validateWidgetQuery,
  readWidgetQuery,
  resolveWidgetSource,
  validateReadWidgetQuery,
  type RawWidgetQuery,
  type WidgetQuery,
  type WidgetQuerySpec,
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

/**
 * The interval vocabulary a `timeseries` query names.
 *
 * Published from the widgets barrel because `WidgetQuery.interval` IS a
 * `TimeseriesInterval`, and every contract a published shape names travels with
 * it: a public property whose type has no public name can be inferred but never
 * annotated. Without this an author holding a `WidgetQuery` cannot declare a
 * reusable interval variable, or offer the choices, without restating the
 * closed set -- a second copy that agrees on the day it is written.
 */
export {
  isTimeseriesInterval,
  TIMESERIES_INTERVALS,
  type TimeseriesInterval,
} from "../collections/query/timeseries-interval";
