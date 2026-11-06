/**
 * Every archetype is classified, checked by the compiler.
 *
 * `DATA_ARCHETYPES` is the set of displays core draws from a card's answer,
 * and `custom` is the one archetype drawn by the widget's own component. A
 * name added to `WIDGET_ARCHETYPES` and left out of both would publish an
 * archetype no declared view maps onto, so no card could ever be drawn by it,
 * with nothing anywhere saying so. This is the thing that says so.
 */
import { expectTypeOf } from "vitest";

import type {
  DataWidgetArchetype,
  UnclassifiedArchetype,
  WidgetArchetype,
} from "../definition";

expectTypeOf<UnclassifiedArchetype>().toBeNever();

// The positive control. A classification that had drifted to `never` would
// satisfy the assertion above while classifying nothing, so each side is
// shown to hold a real archetype.
expectTypeOf<DataWidgetArchetype>().toMatchTypeOf<WidgetArchetype>();
expectTypeOf<"metric">().toMatchTypeOf<DataWidgetArchetype>();
expectTypeOf<"custom">().toMatchTypeOf<WidgetArchetype>();
