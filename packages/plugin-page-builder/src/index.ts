/**
 * "." entry — isomorphic, React-free public API.
 *
 * The plugin is a REGISTRATION surface: it declares the `blocks` field, the
 * pages collection, the permissions and the registry a plugin hands its blocks
 * to. It renders nothing and defines no document model of its own.
 *
 * Both of those used to live here. The package carried a complete parallel
 * implementation — its own `BlockDocument` and `BlockNode`, its own style
 * compiler, its own block library and its own editor — beside the ones in
 * `@nextlyhq/blocks-engine`, `@nextlyhq/blocks-react` and `@nextlyhq/builder`.
 * The two did not merely duplicate each other; they disagreed about what values
 * MEAN. A page's nodes sat under a synthetic root here and in a flat array
 * there, a design token was keyed `token` here and `$token` there, per-node
 * visibility was a flat breakpoint map here and a nested one there, and a
 * binding was a different contract entirely. Each of those crossed a boundary
 * without a type error and changed what rendered.
 *
 * Keeping both was not a cost paid once. It meant every document question had
 * two answers that had to be kept in agreement by hand, and the disagreements
 * only ever surfaced as a page that looked wrong — never as something that
 * failed to compile.
 *
 * So the document model, the style compiler, the block library and the editor
 * are the engine's, the renderer's and the builder's respectively, and this
 * package registers them. The editor is `@nextlyhq/builder`; blocks render
 * through `@nextlyhq/blocks-react`.
 */
export { pageBuilder } from "./plugin";
export type { PageBuilderOptions } from "./plugin";

// The blocks field type and the document it stores. `BlockDocument` is
// re-exported here because generated types name it: an app depends on this
// package, and reaching the engine by name would rely on a transitive
// dependency it has no guarantee of resolving.
export type {
  BlockDocument,
  BlockNode,
  DocumentKind,
} from "@nextlyhq/blocks-engine";

// The bounds a rebuild derives under, for the same reason and by the same rule.
// They are REQUIRED arguments on this package's rebuild entry points, so a host
// running the engine defaults has to name a value — and the only correct value
// lived in a package it has no guarantee of resolving. Without this the two
// available moves are both wrong: take a direct dependency on the engine to
// obtain one constant, or copy the numbers and let them drift silently away
// from the bounds the renderer actually applies.
//
// Re-exported rather than redeclared. A second definition of these numbers is
// the drift itself, and `public-limits-export.test.ts` asserts by REFERENCE
// identity that this is the engine's own object rather than a copy that happens
// to agree today.
export { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
export type { DocumentLimits } from "@nextlyhq/blocks-engine";
export {
  BLOCKS_FIELD_TYPE,
  BLOCKS_TYPE,
  BLOCKS_FIELD_COMPONENT,
} from "./fields/blocksField";
export {
  emptyBlockDocument,
  emptyBlockDocumentJson,
} from "./fields/blocks-document";
export { validateBlocksValue } from "./fields/blocks-validator";
export type { BlocksValidationOptions } from "./fields/blocks-validator";
export type {
  BlocksFieldOptions,
  BlocksFieldValue,
  BlocksFieldConfig,
} from "./fields/blocks-options";
export { blocks, isBlocksField } from "./fields/blocksHelper";
export { pagesCollection } from "./collections/pages";

/**
 * Site style: the layered answer to "what does this site define".
 *
 * `resolveSiteStyle` is the one merge of config defaults and stored edits;
 * `siteBreakpoints`/`siteSheet` read the merged result; `loadSiteStyle` is
 * what a published route calls per request to serve the stored tier, passing
 * the result as the route helper's `siteStyles`. The stored tier lives in the
 * plugin-owned `site-style` single, named by `SITE_STYLE_SLUG`.
 */
export { resolveSiteStyle, siteBreakpoints, siteSheet } from "./site-style";
export type { SiteStyleData } from "./site-style";
export { SITE_STYLE_SLUG, loadSiteStyle } from "./site-style-storage";
export {
  previewViewportsFromSiteStyle,
  siteStyleViewports,
} from "./preview-viewports";
export type { SiteStyleReader } from "./site-style-storage";

// The class-usage index, the derivation behind it, and the walk that repairs
// it.
//
// `classUsageOf` is the derivation: it answers which classes a document
// references, and it is the same answer the write path records. A host that
// needs that question answered for a document it holds asks here rather than
// walking the tree itself, so there is one reading of what a reference is.
//
// The rebuild is public because the index is DERIVED and its maintenance runs
// post-commit: a host that has written pages outside that path — a restore, an
// import, a direct database edit — has rows that no longer describe the
// documents, and a derived store with no reachable way to rebuild it is a
// second source of truth. The stores and the report come with it because a
// caller cannot invoke the walk without supplying the first or reading the
// second.
export { classUsageOf } from "./class-usage";
export type { ClassUsage } from "./class-usage";
// `rebuildPageBuilderUsageIndexes` rather than the general
// `rebuildUsageIndexes` behind it. The general one takes the list of indexes to
// repair, and that list is not a caller's to write: it names package-internal
// descriptors, and a host that could write it could only ever name the indexes
// that existed when its code was written — so an index added later would go
// unrepaired on every upgraded site, which is the undercount this whole export
// exists to prevent. The preconfigured entry point takes the STORES and knows
// the set itself.
export {
  rebuildClassUsageIndex,
  rebuildPageBuilderUsageIndexes,
  type ClassUsageDocumentStore,
  type ClassUsageRebuildReport,
} from "./class-usage-index-rebuild";
export type { ClassUsageIndexStore } from "./class-usage-maintenance";
// Exported because a caller cannot implement `ClassUsageDocumentStore` or call
// the rebuild without naming the variant, and a caller left to spell it as a
// string can spell it wrong.
export type { ClassUsageVariant } from "./collections/class-usage-index";

// "Used on N pages", and the reader that answers it.
//
// Public because the question belongs to the host's surfaces — a library tile,
// a component's own header — and because counting it any other way gets a
// different number. A row is filed per field, per locale and per stored
// variant, so a host counting rows would report one page as several and watch
// the figure climb whenever somebody added a translation.
//
// `usageCountReader` comes with it: the count is asked of a grouped read that
// must run as the system, since the index denies every access rule it declares
// and an untrusted read answers an empty set — indistinguishable from a
// component nothing uses.
//
// The SLUG travels with them, because `usageCountReader` takes one and a
// consumer of the published package has no other way to name it: the plugin
// resolves it from its own context, and that context is not reachable from
// application code. Without this export the only way to call the reader is to
// spell `nx_pb_component_usage` as a literal, which then has to be re-spelled
// by hand if the constant ever changes — a copy of an identifier the package
// owns, kept in step by nobody.
//
// It is the DECLARED slug. An integrator who renamed the collection passes the
// name they chose; the plugin's own wiring resolves a rename the same way, from
// the declared name as the key.
//
// The HEALTH reader is public for the same reason the count is: the count
// requires it, so without this a consumer of the published package could only
// obtain a trustworthy answer by reproducing private queries and identifiers,
// or by hard-coding the health object — which is exactly the confident
// `complete: true` the flag exists to prevent, written by hand.
//
// `componentUsageIndexDescriptor` travels with it because the reader is generic
// over the indexes and a caller outside this package has no other way to name
// the component one.
export {
  componentUsageCount,
  componentUsageIndex as componentUsageIndexDescriptor,
} from "./component-usage";
export { usageCountReader } from "./class-usage-runtime";
export { COMPONENT_USAGE_INDEX_SLUG } from "./collections/component-usage-index";
export { indexIsWhole, readUsageIndexHealth } from "./usage-index-health";
// The service key and its shape, so a host can reach the reader that is
// actually bound to the installation. `readUsageIndexHealth` above answers
// conservatively for a caller that cannot supply the backfill's own state;
// this is how a caller stops having to.
export {
  USAGE_HEALTH_SERVICE,
  type UsageHealthService,
} from "./usage-health-service";
export type { UsageIndexHealth } from "./usage-index-health";
export type { UsageCount } from "./usage-count";
export type { GroupedUsageReader } from "./usage-index";
/*
 * `editorChoiceFields` is gone, along with the per-entry editor switch.
 *
 * It spread a stored `editorMode` select beside a blocks field and a rich-text
 * one. Removed rather than deprecated because what it produced was a COLUMN:
 * leaving it exported would keep new collections writing a UI preference into
 * content, and the whole point of retiring it is that the field decides.
 *
 * A collection that used it keeps both underlying fields until its owner
 * removes them — this stops NEW ones being created, and deletes no data.
 * Replace the spread with `blocks({ name: "content" })` for a page-built entry,
 * or `richText({ name: "body" })` for a written one.
 */

/**
 * Contributing blocks: the registry a plugin hands its blocks to.
 *
 * Only the registration side is here, because that is what belongs to this
 * plugin. The contracts for authoring a block come from
 * `@nextlyhq/plugin-sdk/blocks`, the stable surface a plugin author is offered.
 */
export {
  blockRegistry,
  BLOCK_SERVICE,
  PAGE_BUILDER_PLUGIN,
} from "./blocks/registration-service";
export type { BlockRegistrationService } from "./blocks/registration-service";
// `defineBlock` and `BlockDefinition` are still not re-exported from this root,
// and the reason has changed rather than gone away. There is no longer a rival
// `defineBlock` here to shadow; instead the name belongs to the engine, and a
// second route to it from a plugin package is a second thing to keep stable.
// Block authors take both from `@nextlyhq/plugin-sdk/blocks`, where the export
// is covered by the SDK's stability ledger.
export type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";
