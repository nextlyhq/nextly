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
import { expectTypeOf } from "vitest";

import {
  defineAttentionItem,
  formatWidgetChange,
  formatWidgetNumber,
  WIDGET_CONDITIONS,
  WIDGET_LIFECYCLES,
  widgetChartColour,
  type WidgetChartSlot,
} from "@nextlyhq/plugin-sdk";
import type {
  AttentionCount,
  AttentionItem,
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
  WidgetAccess,
  WidgetInterval,
  WidgetAccessGate,
  WidgetRange,
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

// The figure formatters and the chart colour accessor, from the server-safe root: a figure as
// drawn and as heard, and a slot's colour token.
expectTypeOf(formatWidgetNumber).returns.toHaveProperty("text");
expectTypeOf(formatWidgetNumber).returns.toHaveProperty("label");
expectTypeOf(formatWidgetChange).returns.toHaveProperty("text");
expectTypeOf(widgetChartColour).parameter(0).toEqualTypeOf<WidgetChartSlot>();
expectTypeOf<WidgetChartSlot>().toEqualTypeOf<1 | 2 | 3 | 4 | 5>();

// The Needs attention item a plugin lists under `contributes.dashboard.attention`:
// declared through the SDK's own `defineAttentionItem`, and both of its types
// nameable, so an author can annotate a count they write as a named function.
const _count: AttentionCount = { count: 100, atLeast: true };
const _attention: AttentionItem = defineAttentionItem({
  id: "overdue-orders",
  label: "Overdue orders",
  permission: "read-orders",
  link: "collections/orders",
  count: () => Promise.resolve(_count),
});
void _attention;

// A declared widget's permission gate and a series read's interval and range, nameable from the
// SDK as `defineWidget` is, so an author annotating `access` or a series need not reach into core.
const _gate: WidgetAccessGate = {
  allOf: ["read-orders", { anyOf: ["update-orders", "create-orders"] }],
};
const _access: WidgetAccess = _gate;
const _range: WidgetRange = "90d";
const _interval: WidgetInterval = "week";
void _access;
void _range;
void _interval;

export type { _WidgetSurface };
