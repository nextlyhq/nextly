/**
 * The engine's public exports: bindings, entry content, list and named queries, and visibility conditions.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
// Last, so the bundle reaches the style compiler's parser before the URL
// policy's matcher, as the format entry's boundary test expects of the root.
//
// Bindings: the rules each one is checked against, the formatting of a bound
// value, and the pass that fills bound props before blocks render. One set of
// answers, shared by the renderer, the validator and the editor.
export { BINDING_ISSUE_CODES } from "../binding-issues";
export {
  BINDABLE_KINDS,
  bindablePropTypeOf,
  bindingKindOf,
  canBindFieldToProp,
  FIELD_TYPE_BINDING_KIND,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
} from "../binding-vocabulary";
export type {
  BindablePropType,
  BindingEndpoint,
  BindingFieldType,
  BindingValueKind,
  FieldStoragePrimitive,
  StorageFieldType,
} from "../binding-vocabulary";
export type { BindingIssue, BindingIssueCode } from "../binding-issues";
export {
  bindablePropKind,
  checkBinding,
  fieldFitsProp,
  imageValueOf,
  isBindPath,
  isEmptyBoundValue,
  isValidPropValue,
} from "../binding-rules";
export type {
  BindablePropKind,
  BindingCheck,
  BindingCheckInput,
  BindingFieldShape,
  BindingRefs,
  BindingSchemaRef,
  BindingSchemaSource,
  CheckedBinding,
  CrossedRelation,
  ImageValue,
} from "../binding-rules";
// A document's bindings judged against the schema of what they read, as a
// save judges them: one rule with the renderer, a held break a warning.
export {
  bindingSchemaIssues,
  ENTRY_LINK_PROPS,
} from "../binding-schema-issues";
export type {
  BindingDocument,
  BindingSchemaJudgement,
} from "../binding-schema-issues";
export {
  checkFormat,
  createBindingFormatter,
  machineDate,
  safeTimeZone,
  supportedLocale,
} from "../binding-format";
export type {
  BindingFormatter,
  CheckedFormat,
  FormatCheck,
  FormatEnv,
  FormatResult,
  FormattedValue,
} from "../binding-format";
export {
  bindDocument,
  bindingDemand,
  bindingFormatEnv,
  bindingRefsFor,
  createBindingRun,
  DEFAULT_BINDING_LOCALE,
  hasItemBindings,
  resolveNodeBindings,
  runDrawsImageField,
} from "../resolve-bindings";
export type {
  BindingDemand,
  BindingRun,
  BindingRunInput,
  BindingScope,
  BindingSources,
  BlockPropsLookup,
  BoundDocument,
  BoundValue,
  BoundValues,
  NodeBindingResult,
  SourceDemand,
} from "../resolve-bindings";
// The bound props a visitor will not see: the page's own binding check, asked
// with the field shapes a visitor may read, for an editor to say so.
export { visitorUnreadableBindings } from "../visitor-unreadable-bindings";
export {
  SITE_SETTING_FIELD_SHAPES,
  SITE_SETTING_FIELD_TYPES,
  SITE_SETTING_LABELS,
  type SiteSettingName,
} from "../site-setting-fields";
export type {
  VisitorUnreadableBinding,
  VisitorUnreadableInput,
} from "../visitor-unreadable-bindings";

// The Entry content block: where a collection's template draws the entry's
// own blocks content. Its rules, shared by the validator, the editor and the
// page builder's save, and the one composition of an entry's content into a
// template for drawing, shared by the published page and the editor's canvas.
export {
  composeEntryContent,
  entryBlocksDocumentOf,
  ENTRY_CONTENT_FIELD_PROP,
  ENTRY_CONTENT_ISSUE_CODES,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  entryContentFieldOf,
  entryContentIssues,
  entryContentPlacements,
  holdsEntryContent,
} from "../entry-content";
export type {
  EntryContentIssue,
  EntryContentIssueCode,
  EntryContentJudgement,
  EntryContentPlacement,
  EntryContentSource,
} from "../entry-content";

// A collection list's stored query: the one reading of it, shared by the
// validator, the renderer and the editor, and its save-time judgement.
export {
  COLLECTION_LIST_TYPE,
  isListDay,
  isListFilterOp,
  LIST_ENTRY_SLOT,
  listDayAfter,
  LIST_FIELD_CODES,
  LIST_FILTER_OPS,
  LIST_ISSUE_CODES,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  LIST_FIELD_KINDS,
  LIST_KIND_OPS,
  LIST_MAX_FILTERS,
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  LIST_MAX_VALUES,
  isListFieldKind,
  listFieldKind,
  listItemRef,
  listKindSortable,
  listPageCount,
  listQueryIssues,
  namesListSource,
  listRelationTarget,
  listSortText,
  mayPaginateList,
  namedQueryHiddenReads,
  outerListOf,
  paginatedList,
  readListQuery,
} from "../list-query";
// The day an instant falls on in a zone, `YYYY-MM-DD`: a page's "today", as
// a published page and the editor's canvas each read it for a named query.
export { calendarDayIn } from "../calendar-day";
// Named queries: a collection list's custom source, declared by a developer
// in code. The declaration's types and checks, the process registry the page
// builder fills at boot, and every message about one, shared by the
// validator, the renderer, the editor and the plugin SDK.
export {
  createNamedQueryRegistry,
  defineNamedQuery,
  isNamedQueryName,
  isNamedQueryParamKey,
  judgeNamedParams,
  NAMED_QUERY_DEFAULT_TIMEOUT_MS,
  NAMED_QUERY_MAX_PARAMS,
  NAMED_QUERY_MAX_TIMEOUT_MS,
  NAMED_QUERY_TEXT,
  NAMED_QUERY_TEXT_MAX,
  namedQueryDeclaration,
  namedQueryNeedsInput,
  namedQueryParamNeedsInput,
  namedQueryProblem,
  namedQueryRowFields,
  namedQueryTimeout,
  param,
} from "../named-query";

// A block's visibility conditions: the operator vocabulary and its render
// classes, the evaluator the renderer asks, and their save-time judgement.
export {
  canonicalConditions,
  conditionDemand,
  conditionScopeIn,
  CONDITION_FIELD_CODES,
  CONDITION_ISSUE_CODES,
  CONDITION_KIND_OPS,
  CONDITION_MAX,
  CONDITION_OP_ALIASES,
  CONDITION_OPS,
  CONDITION_REGISTRY,
  conditionFieldKind,
  conditionIssues,
  conditionOp,
  evaluateConditions,
  withConditions,
} from "../visibility-conditions";
export type {
  ConditionDayStart,
  ConditionDemand,
  ConditionEvaluation,
  ConditionFieldKind,
  ConditionInput,
  ConditionIssue,
  ConditionIssueCode,
  ConditionJudgement,
  ConditionOp,
  ConditionRegistry,
  ConditionRenderClass,
  ConditionScope,
  ConditionSource,
  ConditionSubject,
} from "../visibility-conditions";
export type {
  BooleanParam,
  ChoiceParam,
  DayParam,
  EntryParam,
  NamedParamJudgement,
  NamedParamProblem,
  NamedQueryChoice,
  NamedQueryDeclaration,
  NamedQueryDefinition,
  NamedQueryKnown,
  NamedQueryNeed,
  NamedQueryParam,
  NamedQueryParams,
  NamedQueryParamType,
  NamedQueryParamValue,
  NamedQueryParamValues,
  NamedQueryReader,
  NamedQueryRegistry,
  NamedQueryResult,
  NamedQueryRows,
  NamedQueryRunArgs,
  NamedQuerySource,
  NamedReadFilter,
  NamedReadQuery,
  NumberParam,
  TextParam,
} from "../named-query";
export type {
  ListNamedQuery,
  NamedQueryHiddenRead,
  ListFieldCode,
  ListFieldKind,
  ListFields,
  ListFieldSource,
  ListFilter,
  ListFilterOp,
  ListFilterScalar,
  ListPageCode,
  ListQuery,
  ListQueryJudgement,
  ListQueryProblem,
  ListQueryProp,
  ListRelation,
  ListShapeCode,
  ListSortKey,
  PaginatedList,
} from "../list-query";
