/**
 * Type-level test: the dashboard-widget surface is re-exported from the SDK
 * boundary. Checked by `tsc --noEmit` (check-types).
 *
 * The reason this exists: AGENTS.md states a plugin imports only from
 * `@nextlyhq/plugin-sdk` and `@nextlyhq/ui`, never from core. The widget
 * registry and the query contract were exported from the `nextly` root alone,
 * so an author following the documented surface could not name a single one of
 * them -- the registry was reachable only by reaching into core.
 *
 * Using each export in a type position makes the compiler error if any is
 * missing.
 */
import { WIDGET_CONDITIONS, WIDGET_LIFECYCLES } from "@nextlyhq/plugin-sdk";
import type {
  WidgetLifecycle,
  WidgetCondition,
  WidgetDefinition,
  WidgetQuery,
  WidgetSize,
  WidgetHeight,
  WidgetArchetype,
  WidgetSource,
  WidgetSourceField,
  WidgetSourceFieldType,
  WidgetSourceKind,
  WidgetOp,
} from "@nextlyhq/plugin-sdk";

type _WidgetSurface = [
  WidgetDefinition,
  WidgetQuery,
  WidgetSize,
  WidgetHeight,
  WidgetArchetype,
  WidgetSource,
  WidgetSourceField,
  WidgetSourceFieldType,
  WidgetSourceKind,
  WidgetOp,
];

// Every contract the published shapes NAME must be nameable too, which is the
// property a bare `WidgetDefinition` export would not have: `defaultHeight` is
// a `WidgetHeight`, and a `WidgetSource`'s `fields` are `WidgetSourceField`s.
// Annotating -- not inferring -- is what proves the names are reachable.
const _height: WidgetHeight = "tall";
const _field: WidgetSourceField = { name: "title", type: "string" };
const _op: WidgetOp = "count";
void _height;
void _field;
void _op;

// The lifecycle pair, both halves. `WidgetDefinition.lifecycle` is a
// `WidgetLifecycle` and `visibleWhen` a `WidgetCondition`, so an author who
// cannot name them cannot annotate a declaration they write. The CONSTANTS
// travel too -- a closed set is what an options UI enumerates, and enumerating
// it by retyping the literals is a copy that stops matching when the set grows.
const _lifecycle: WidgetLifecycle = "conditional";
const _condition: WidgetCondition = "content:empty";
const _vocabulary: readonly string[] = [
  ...WIDGET_LIFECYCLES,
  ...WIDGET_CONDITIONS,
];
void _lifecycle;
void _condition;
void _vocabulary;

export type { _WidgetSurface };
