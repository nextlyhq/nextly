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
  PluginAdminCustomWidget,
  PluginAdminQuerylessWidget,
  PluginAdminTextWidget,
  PluginAdminWidget,
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

// `chrome: "none"` is only WRITABLE on a widget core does not draw itself.
//
// `validateChrome` refuses the pair at boot, and a type that permitted it made
// that refusal the first time an author found out -- after the plugin shipped.
// Asserted with `expectTypeOf`, which the checker evaluates, rather than
// `@ts-expect-error`, which suppresses whatever error happens to be on the line
// and would keep passing if the rejection stopped happening for another reason.
expectTypeOf<{
  id: string;
  component: "acme#X";
  archetype: "metric";
  chrome: "none";
}>().not.toMatchTypeOf<PluginAdminCustomWidget>();

// The two positive controls. A `chrome` field nothing could ever set would
// satisfy the assertion above while making the option undeclarable.
expectTypeOf<{
  id: string;
  component: "acme#X";
  archetype: "custom";
  chrome: "none";
}>().toMatchTypeOf<PluginAdminCustomWidget>();

// And the load-bearing one: a component standing in as the FALLBACK body for an
// archetype this admin cannot draw is still declarable. Narrowing `archetype`
// to `"custom"` would have refused this, which is a real declaration -- core
// reports a query-less metric as undrawable and the component renders.
expectTypeOf<{
  id: string;
  component: "acme#X";
  archetype: "metric";
}>().toMatchTypeOf<PluginAdminCustomWidget>();

// `content` is writable on `text` and nowhere else. The boot validator refuses
// it on every other archetype, and an arm that left the field open accepted a
// declaration boot then aborted on -- a component-only widget written inline
// with prose, or a data widget carrying it after inference had widened it.
expectTypeOf<{
  id: string;
  archetype: "text";
  content: "notes";
}>().toMatchTypeOf<PluginAdminWidget>();
expectTypeOf<{
  id: string;
  component: "acme#X";
  content: "notes";
}>().not.toMatchTypeOf<PluginAdminWidget>();
expectTypeOf<{
  id: string;
  archetype: "metric";
  query: { source: "collection:posts"; op: "count" };
  content: "notes";
}>().not.toMatchTypeOf<PluginAdminWidget>();
expectTypeOf<{
  id: string;
  archetype: "actions";
  actions: [{ label: "Go"; href: "/go" }];
  content: "notes";
}>().not.toMatchTypeOf<PluginAdminWidget>();

// A component beside a queryless archetype is not a fallback case: the prose
// or the list is still required, and only the arm that requires it can say
// so. The type routes the declaration there rather than accepting a text
// widget with no text through the custom arm.
expectTypeOf<{
  id: string;
  component: "acme#X";
  archetype: "text";
}>().not.toMatchTypeOf<PluginAdminWidget>();
expectTypeOf<{
  id: string;
  component: "acme#X";
  archetype: "text";
  content: "notes";
}>().toMatchTypeOf<PluginAdminWidget>();
