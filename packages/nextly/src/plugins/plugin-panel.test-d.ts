/**
 * A plugin's panel as its admin config declares it: groups, and on a menu
 * item a group and either a quiet count or a badge, each counting one of the
 * plugin's own collections or one of its attention items.
 *
 * Each `@ts-expect-error` below is paired with a `not.toExtend` assertion the
 * checker evaluates, so a directive left satisfied by some other error on its
 * line does not stand as the only evidence of a refusal.
 */
import { expectTypeOf } from "vitest";

import type {
  PluginAdminContributions,
  PluginAdminPanel,
  PluginItemCount,
  PluginMenuItem,
  PluginPanelGroup,
} from "./admin-contributions";

// The panel's groups, in a readonly array as a constant list is written.
expectTypeOf<PluginAdminContributions["panel"]>().toEqualTypeOf<
  PluginAdminPanel | undefined
>();
expectTypeOf<PluginAdminPanel["groups"]>().toEqualTypeOf<
  ReadonlyArray<PluginPanelGroup>
>();
expectTypeOf<PluginPanelGroup>().toEqualTypeOf<{ id: string; label: string }>();

const groups = [
  { id: "library", label: "Library" },
  { id: "checks", label: "Checks" },
] as const;
const admin: PluginAdminContributions = {
  panel: { groups },
  menu: [
    // A quiet count of an own collection, narrowed by a where.
    {
      label: "Patterns",
      to: "/admin/collections/patterns",
      collection: "patterns",
      group: "library",
      count: { collection: "patterns", where: { status: { equals: "draft" } } },
    },
    // A badge from an own attention item.
    {
      label: "Bindings to fix",
      to: "/admin/plugins/acme/bindings-to-fix",
      group: "checks",
      badge: { attention: "acme/bindings-to-fix" },
    },
    // A badge may count a collection, and a count an attention item.
    {
      label: "Drafts",
      to: "/admin/collections/patterns",
      badge: { collection: "patterns" },
    },
    {
      label: "Waiting",
      to: "/admin/plugins/acme/w",
      count: { attention: "a" },
    },
    // And an item may carry neither, as every item did before.
    { label: "Plain", to: "/admin/plugins/acme/plain" },
  ],
};
expectTypeOf(admin).toExtend<PluginAdminContributions>();

// An item takes a count or a badge, never both.
// The two on one line, so the expected error is the only one it can hold.
const count = { collection: "patterns" };
const badge = { attention: "acme/bindings-to-fix" };
// @ts-expect-error -- a count and a badge on one item
const both: PluginMenuItem = { label: "Both", to: "/x", count, badge };
void both;
expectTypeOf<{
  label: string;
  to: string;
  count: { collection: string };
  badge: { attention: string };
}>().not.toExtend<PluginMenuItem>();

// A count names a collection or an attention item: one of them, and not both.
// @ts-expect-error -- a count naming neither
const neither: PluginItemCount = {};
void neither;
expectTypeOf<{
  where: Record<string, never>;
}>().not.toExtend<PluginItemCount>();
expectTypeOf<{
  collection: string;
  attention: string;
}>().not.toExtend<PluginItemCount>();
// A `where` belongs to a collection count alone.
expectTypeOf<{
  attention: string;
  where: { status: { equals: string } };
}>().not.toExtend<PluginItemCount>();
