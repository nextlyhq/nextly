/**
 * Every archetype is classified, checked by the compiler.
 *
 * `DATA_ARCHETYPES` and `QUERYLESS_ARCHETYPES` are what both channels into the
 * grid derive their rules from — `validateWidgetDefinition` here, and the
 * `PluginAdminWidget` union that decides what a plugin may declare. A name
 * added to `WIDGET_ARCHETYPES` and left out of both sets falls outside every
 * one of those rules at once: accepted with a query and without one, and
 * undeclarable through the contributions channel, with nothing anywhere saying
 * so. This is the thing that says so.
 */
import { expectTypeOf } from "vitest";

import type {
  DataWidgetArchetype,
  QuerylessWidgetArchetype,
  UnclassifiedArchetype,
  WidgetArchetype,
} from "../definition";

expectTypeOf<UnclassifiedArchetype>().toBeNever();

// The positive control. A classification that had drifted to `never` on both
// sides would satisfy the assertion above while classifying nothing.
expectTypeOf<DataWidgetArchetype>().toMatchTypeOf<WidgetArchetype>();
expectTypeOf<QuerylessWidgetArchetype>().toMatchTypeOf<WidgetArchetype>();
expectTypeOf<"metric">().toMatchTypeOf<DataWidgetArchetype>();
expectTypeOf<"text">().toMatchTypeOf<QuerylessWidgetArchetype>();
