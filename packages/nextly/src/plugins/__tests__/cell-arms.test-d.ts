/**
 * Every cell archetype has an arm in the contributions union, checked by the
 * compiler.
 *
 * The companion to `queryless-arms.test-d.ts`, for the third category. A name
 * added to `CELL_ARCHETYPES` with no arm here is accepted by the boot gate --
 * which derives its rule from the vocabulary -- and rejected by the type a
 * plugin author actually writes against, with nothing anywhere saying so. That
 * is precisely what shipped for `stats`: core registered and drew it, and the
 * documented typed contribution path could not express it.
 */
import { expectTypeOf } from "vitest";

import type { CellWidgetArchetype } from "../../domains/widgets/definition";
import type {
  PluginAdminDeclarativeWidget,
  PluginAdminStatsWidget,
} from "../admin-contributions";

/** A cell archetype with no arm in the union above. */
type UnarmedCellArchetype = Exclude<
  CellWidgetArchetype,
  PluginAdminStatsWidget["archetype"]
>;

expectTypeOf<UnarmedCellArchetype>().toBeNever();

// The positive control. `Exclude` of a vocabulary that had drifted to `never`
// is also `never`, which satisfies the assertion above while arming nothing.
expectTypeOf<PluginAdminStatsWidget>().toMatchTypeOf<PluginAdminDeclarativeWidget>();
expectTypeOf<PluginAdminStatsWidget["archetype"]>().toEqualTypeOf<"stats">();
