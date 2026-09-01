/**
 * Every queryless archetype has an arm in the contributions union, checked by
 * the compiler.
 *
 * The companion to `domains/widgets/__tests__/archetype-classification.test-d.ts`,
 * one layer out: that file asserts core CLASSIFIES every archetype, this one
 * asserts the authoring union can DECLARE every queryless archetype it
 * classified. A name added to `QUERYLESS_ARCHETYPES` with no arm here is
 * accepted by the boot gate -- which derives its rule from the vocabulary --
 * and rejected by the type a plugin author actually writes against, with
 * nothing anywhere saying so.
 *
 * `expectTypeOf` rather than a bare conditional alias, because the checker has
 * to EVALUATE the assertion for it to be one. The construct this replaced,
 * `type _Guard = Unarmed extends never ? true : never`, resolves to `never` and
 * stops there: an unused type alias, whatever it resolves to, is not a
 * diagnostic. Measured before replacing it -- a third, unarmed archetype added
 * to the vocabulary left `tsc --noEmit --strict` exiting 0.
 */
import { expectTypeOf } from "vitest";

import type {
  PluginAdminActionsWidget,
  PluginAdminQuerylessWidget,
  PluginAdminTextWidget,
  UnarmedQuerylessArchetype,
} from "../admin-contributions";

expectTypeOf<UnarmedQuerylessArchetype>().toBeNever();

// The positive control. `Exclude` of a vocabulary that had itself drifted to
// `never` is also `never`, which satisfies the assertion above while arming
// nothing -- so each arm is named here against the union it must belong to.
expectTypeOf<PluginAdminTextWidget>().toMatchTypeOf<PluginAdminQuerylessWidget>();
expectTypeOf<PluginAdminActionsWidget>().toMatchTypeOf<PluginAdminQuerylessWidget>();
expectTypeOf<PluginAdminTextWidget["archetype"]>().toEqualTypeOf<"text">();
expectTypeOf<
  PluginAdminActionsWidget["archetype"]
>().toEqualTypeOf<"actions">();
