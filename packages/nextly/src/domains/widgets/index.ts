/**
 * The widget domain's public surface.
 *
 * @module domains/widgets
 */

export {
  DATA_ARCHETYPES,
  validateWidgetDefinition,
  type WidgetSetting,
} from "./definition";
// The one size vocabulary, beside the definition whose `size` names it: the
// grid's width and the size types. Its functions reach the admin through
// `nextly/config`, which exports them from `grid-size.ts` directly.
export {
  GRID_COLUMNS,
  type GridSize,
  type WidgetSizeBounds,
  type WidgetSizeDeclaration,
} from "./grid-size";
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
  type WidgetFieldChoice,
  type WidgetSourceFieldType,
  type WidgetSourceKind,
  type WidgetOp,
} from "./sources";
export {
  registerWidget,
  deregisterWidget,
  widgetSource,
  clearWidgets,
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

/**
 * The contract a source is resolved against: the shape core's own system
 * sources use, with the caller and the host's `ResolverOptions` it is handed.
 *
 * `ReadCaller` and `ResolverOptions` travel with it because they are its other
 * arguments, so without them a parameter has no name to annotate. `WidgetScope`
 * is the batch-shared work `ResolverOptions` carries, and is `@experimental`.
 */
export type {
  SourceResolver as WidgetSourceResolver,
  ResolverOptions,
  WidgetScope,
} from "./resolved-sources";
export type { ReadCaller } from "../../services/dashboard/readable-resources";
export { callerReadOptions } from "./caller-read-options";
