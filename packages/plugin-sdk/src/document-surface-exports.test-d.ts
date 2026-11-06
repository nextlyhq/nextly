/**
 * The surface a plugin changes a collection's document screen through: the
 * overrides it declares under `contributes.admin.views[slug]`, and the props
 * its components receive.
 *
 * What these pin is the contract a plugin compiles against: which actions may
 * be overridden (exactly two today, so a third is a deliberate widening), the
 * two shapes an override takes, where both keys sit on the collection view,
 * and the results a component reports back. Every assertion is one the
 * checker evaluates; none rests on `@ts-expect-error`.
 */
import { expectTypeOf } from "vitest";

import type {
  OverridableDocumentAction,
  PluginCollectionView,
  PluginDocumentActionOverride,
  PluginDocumentActionOverrides,
  PluginPanelSection,
} from "@nextlyhq/plugin-sdk";
import type {
  DocumentActionReplacementProps,
  DocumentChangeResult,
  DocumentLockGates,
  DocumentPanelSectionProps,
  OverridableDocumentAction as AdminOverridableDocumentAction,
  PluginDocumentActionOverride as AdminPluginDocumentActionOverride,
  PluginPanelSection as AdminPluginPanelSection,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf<OverridableDocumentAction>().toEqualTypeOf<
  "delete" | "unpublish"
>();

expectTypeOf<PluginDocumentActionOverride>().toEqualTypeOf<
  "hidden" | { component: string; label?: string }
>();

expectTypeOf<PluginDocumentActionOverrides>().toEqualTypeOf<
  Partial<Record<"delete" | "unpublish", PluginDocumentActionOverride>>
>();

expectTypeOf<PluginPanelSection>().toEqualTypeOf<{
  title: string;
  component: string;
}>();

// Both keys sit on the per-collection view, optional, beside its other slots.
expectTypeOf<PluginCollectionView["documentActions"]>().toEqualTypeOf<
  PluginDocumentActionOverrides | undefined
>();
expectTypeOf<PluginCollectionView["panelSections"]>().toEqualTypeOf<
  PluginPanelSection[] | undefined
>();

// The admin entry names the same types as the root, not copies of them.
expectTypeOf<AdminOverridableDocumentAction>().toEqualTypeOf<OverridableDocumentAction>();
expectTypeOf<AdminPluginDocumentActionOverride>().toEqualTypeOf<PluginDocumentActionOverride>();
expectTypeOf<AdminPluginPanelSection>().toEqualTypeOf<PluginPanelSection>();

expectTypeOf<DocumentChangeResult>().toEqualTypeOf<"deleted" | "changed">();

expectTypeOf<DocumentActionReplacementProps>().toEqualTypeOf<{
  action: OverridableDocumentAction;
  collectionSlug: string;
  entryId: string;
  documentLock: DocumentLockGates;
  mayWrite: () => boolean;
  close: (result?: DocumentChangeResult) => void;
}>();

expectTypeOf<DocumentPanelSectionProps>().toEqualTypeOf<{
  collectionSlug: string;
  entryId: string;
  documentLock: DocumentLockGates;
  mayWrite: () => boolean;
  documentChanged: (result: DocumentChangeResult) => void;
}>();
