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
  GridSize,
  WidgetLifecycle,
  WidgetCondition,
  WidgetDefinition,
  WidgetQuery,
  WidgetSizeDeclaration,
  WidgetArchetype,
  WidgetSource,
  WidgetSourceField,
  WidgetFieldChoice,
  WidgetSourceFieldType,
  WidgetSourceKind,
  WidgetOp,
} from "@nextlyhq/plugin-sdk";

type _WidgetSurface = [
  WidgetDefinition,
  WidgetQuery,
  GridSize,
  WidgetSizeDeclaration,
  WidgetArchetype,
  WidgetSource,
  WidgetSourceField,
  WidgetFieldChoice,
  WidgetSourceFieldType,
  WidgetSourceKind,
  WidgetOp,
];

// Every contract the published shapes NAME must be nameable too, which is the
// property a bare `WidgetDefinition` export would not have: `size` is a
// `WidgetSizeDeclaration` of `GridSize`s, and a `WidgetSource`'s `fields` are
// `WidgetSourceField`s. Annotating -- not inferring -- is what proves the names
// are reachable.
const _unit: GridSize = { w: 6, h: 4 };
const _size: WidgetSizeDeclaration = { default: _unit, max: { w: 12, h: 6 } };
const _declared: WidgetDefinition["size"] = _size;
const _field: WidgetSourceField = { name: "title", type: "string" };
const _op: WidgetOp = "count";
void _declared;
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
