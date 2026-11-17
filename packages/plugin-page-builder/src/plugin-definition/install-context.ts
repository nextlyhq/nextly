/**
 * The installed plugin as its parts read it. `installContext` is what a usage
 * backfill pass enumerates the site through; beside it are the readers it and
 * the rest of `init`'s wiring share: the registered collections, the live
 * Singles holding blocks, the site's field groups, the Site Style Single's
 * reads, and what the component-delete rewrite and a removal's hold read the
 * site through. Also the named queries each page builder registers, for
 * `namedQueriesOf`.
 */
import {
  DEFAULT_LIMITS,
  type BlockRegistryReader,
} from "@nextlyhq/blocks-engine";
import { SITE_COPY, type NamedQueryLookup } from "@nextlyhq/blocks-react";
import {
  type definePlugin,
  NextlyError,
  type HookContext,
  resolvedCollectionDraftSplit,
  resolvedCollectionView,
  type PluginCollectionTransaction,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";

import {
  hasStarted,
  runningBlocks,
  runningRegistry,
} from "../blocks/registration-service";
import { blocksFieldReach } from "../class-usage-blocks-fields";
import type { CommittedWriteReconciler } from "../class-usage-hook";
import { COMPONENT_RETIRED_SLUG } from "../collections/component-retired-exposures";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { declaredSingleSlugs, isOrphanedSingle } from "../declared-singles";
import type { CompositionSetup } from "../fields/blocks-composition";
import { readSiteFieldGroups } from "../host-rewrite/field-groups";
import type { RewriteInstall } from "../host-rewrite/service";
import {
  singleToWalk,
  type RewriteDirectApi,
  type SingleToWalk,
} from "../host-rewrite/site";
import {
  installRemovalHolds,
  removalHoldStore,
  type HoldDirectApi,
  type PlacementCount,
  type RemovalHoldStore,
} from "../removal-hold";
import { blocksFieldPaths } from "../retired-exposure-hooks";
import {
  siteDefinitionsOfDocument,
  siteStyleDocumentOn,
} from "../site-definitions";
import type { SiteStyleData } from "../site-style";
import { SITE_STYLE_SLUG, siteStyleOfDocument } from "../site-style-storage";
import type { BackfillHost } from "../usage-backfill-wiring";
import { usageBookkeeping } from "../usage-bookkeeping";
import { SINGLE_HOOK_NAMESPACE } from "../write-target";

import type { PageBuilderOptions } from "./options";
import {
  REGISTRY_PAGE_SIZE,
  singlesRegistryPages,
  UNREADABLE_PAGE,
} from "./registry-reads";

/**
 * Every collection slug the registry holds, or `undefined` when it could not
 * be read.
 *
 * PAGED, and the paging is the point rather than a formality. The listing is
 * paginated, so a single unpaged call returns the server's default page — and
 * the collections past it would simply have no scopes, while completion is
 * judged against that same short list and reports the index whole. That is the
 * defect this enumeration exists to remove, reintroduced by reading it
 * carelessly.
 *
 * `hasMore` is what ends the loop, so the read is exhausted rather than assumed
 * to fit. A page that cannot be understood ends it as a REFUSAL — `undefined`
 * rather than what was collected so far — because a short list here is
 * indistinguishable from a small site.
 */
export async function registeredCollectionSlugs(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<readonly string[] | undefined> {
  const slugs: string[] = [];

  // The row count the first page reported, so a population that CHANGED while
  // this walked is refused rather than partially read. The listing pages by
  // offset, so deleting a row the walk has already passed shifts everything
  // behind it back and the next page starts one row late — the row that crossed
  // the boundary is never seen. It gets no scopes, completion is judged against
  // a list missing it, and health reports the index whole while that
  // collection's documents are unindexed. That is the confident-zero this
  // enumeration exists to remove, arriving through the paging.
  //
  // The service offers no cursor, only `page`/`limit`, so a keyset walk is not
  // available here. Comparing the total is what IS available, and it catches
  // the deletion this fails on. It does not catch a delete and a create in the
  // same window, which leaves the count unchanged — stated rather than implied,
  // because a fence that reads as complete is worse than one with a named edge.
  let expected: number | undefined;

  for (let page = 1; ; page += 1) {
    const listed: unknown = await ctx.services.collections.listCollections(
      // Ordered so the pages partition the rows: an unordered paged read has no
      // defined order between pages, so a slug can appear twice or not at all.
      { page, limit: REGISTRY_PAGE_SIZE, sortBy: "slug", sortOrder: "asc" },
      // A sweep acts as nobody, and listing which collections exist is not the
      // privileged part.
      undefined as never
    );

    const rows = (listed as { data?: unknown }).data;
    const pagination = (
      listed as {
        pagination?: { hasMore?: unknown; total?: unknown };
      }
    ).pagination;
    if (
      !Array.isArray(rows) ||
      typeof pagination?.hasMore !== "boolean" ||
      typeof pagination.total !== "number"
    ) {
      return undefined;
    }
    expected ??= pagination.total;
    if (pagination.total !== expected) return undefined;

    for (const row of rows) {
      const slug = (row as { slug?: unknown }).slug;
      // A row whose slug cannot be read is a collection this cannot enumerate,
      // and dropping it silently is the same defect as a short page: its scopes
      // are never created, so completeness is judged against a list missing it
      // and reports the index whole while that collection's content is
      // unindexed. Refused rather than skipped, for the reason every other
      // unreadable input here is.
      if (typeof slug !== "string" || slug.length === 0) return undefined;
      slugs.push(slug);
    }

    if (!pagination.hasMore) return slugs;
  }
}

/**
 * Turn the installed plugin context into what a backfill pass needs.
 *
 * Every member is a FUNCTION rather than a resolved value, and that is the
 * whole shape of it. A site can gain a collection, a locale or a draft variant
 * after boot, and the Direct API is not resolvable until services are
 * registered — so anything captured here would be a fact about the moment the
 * plugin was installed, used to decide whether an index covering the site as it
 * is now is complete.
 */
export function installContext(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  opts: PageBuilderOptions
): BackfillHost {
  const nextly = async () => (await import("nextly/runtime")).requireNextly();
  return {
    /*
     * Imported at CALL time, not at module scope, for the reason the preview
     * reader above gives: this entry is isomorphic and reachable from a browser
     * bundle, and `nextly/runtime` aggregates the request lifecycle — its graph
     * reaches `fs`, `crypto`, `module`, `async_hooks` and more, none of which a
     * browser can resolve or run. A static import puts all of it in the module
     * graph of every consumer that imports so much as `isBlocksField` from the
     * package root.
     *
     * Resolved per pass either way. `requireNextly` refuses until services are
     * registered and boot migrations have settled, which is exactly the guard a
     * job wants: a pass that ran too early fails and is re-queued rather than
     * reading a database whose schema is unverified.
     */
    nextly,
    // The LIVE registry, not the configured list. `class-usage-hook` opens by
    // saying the set of collections is not known when a plugin is wired — which
    // is why the write path registers on the wildcard — because the Schema
    // Builder creates collections at runtime and those exist only here. A
    // backfill reading the configured set would walk a narrower population than
    // the hooks maintain while judging readiness against that same short list.
    //
    // A superset rather than a different set: code-first collections are synced
    // into the registry with `source: "code"`, so nothing declared is lost.
    //
    // `undefined` when the registry cannot be read, which the enumeration
    // treats as a refusal rather than as a site with nothing to index.
    collectionSlugs: () => registeredCollectionSlugs(ctx),
    // The REGISTRY record, which is what carries the resolved fields and the
    // draft split — the declared config alone answers neither after a rename.
    // No request context: a sweep acts as nobody, and reading a collection's
    // own configuration is not the privileged part.
    resolveCollection: slug =>
      ctx.services.collections.getCollection(slug, undefined as never),
    hasDrafts: async collection =>
      (await resolvedCollectionDraftSplit(resolvedCollectionView(collection)))
        .eligible,
    singles: () => singlesDeclaringBlocks(ctx),
    // Through the rewrite's own reader, so the index and the rewrite answer
    // "what does this field group hold" the same way, from the registry a
    // reload and the admin both write to.
    fieldGroups: siteFieldGroups(ctx, nextly),
    locales: () =>
      ctx.config.localization?.locales.map(locale => locale.code) ?? [],
    // The SAME bounds the renderer draws under, for the reason the write path
    // reads them per call: an index derived under different ones records a
    // different document than the page serves.
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    // The index rows, in the plugin's own tables.
    db: ctx.db,
    // The run, its progress and the dirty mark, in the plugin's own tables.
    bookkeeping: () => usageBookkeeping(ctx.db, ctx.dialect),
  };
}

/**
 * The hold a component's removal takes while it is published, wired over the
 * plugin's bookkeeping table: the fence on every write, the count again as
 * the publish is written, and the release once it lands (`removal-hold`).
 */
export function installHoldsFor(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  opts: PageBuilderOptions,
  composition: CompositionSetup,
  parts: {
    readonly nextly: () => Promise<HoldDirectApi>;
    readonly count: (componentId: string) => Promise<PlacementCount>;
  }
): RemovalHoldStore {
  const { collection, field } = composition.store;
  return installRemovalHolds({
    ctx,
    store: removalHoldStore({
      nextly: parts.nextly,
      // RESOLVED, for the reason every own table is: a host may rename it.
      collection:
        ctx.self.collections[COMPONENT_RETIRED_SLUG] ?? COMPONENT_RETIRED_SLUG,
    }),
    componentCollection: collection,
    componentField: field,
    storedDraft: storedDraftOf,
    // The declared blocks fields, surveyed as the strip on every write
    // surveys them.
    paths: (slug, context) =>
      blocksFieldPaths(ctx, slug, context as HookContext<unknown>),
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    count: parts.count,
    lifecycle: async () => {
      const store = (await ctx.services.collections.getCollection(
        collection,
        undefined as never
      )) as { status?: unknown } | null;
      return store?.status === true;
    },
  });
}

/** The context the plugin's `init` is handed. */
export type InitContext = Parameters<
  NonNullable<Parameters<typeof definePlugin>[0]["init"]>
>[0];

/**
 * The Site Style Single's reads a write is judged by: its record as stored,
 * through the Direct API or on a write's own transaction, and what it
 * defines, by the one reading of a record (`site-definitions`).
 */
export function siteStyleReads(
  ctx: InitContext,
  defaults: SiteStyleData
): {
  documentOn: (transaction: PluginCollectionTransaction) => Promise<unknown>;
  styleNow: () => Promise<SiteStyleData>;
  definitions: NonNullable<CompositionSetup["siteDefinitions"]>;
} {
  // The Single as the host renamed it.
  const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  // The record as stored now, read through the Direct API when asked.
  const documentNow = async (): Promise<unknown> => {
    // Imported at call time, for the reason `defaultLayoutDeps` gives: this
    // entry reaches a browser bundle, where the Direct API has no place.
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    const nextly = await getCachedNextly();
    return nextly.findSingle({ slug });
  };
  // On the transaction's own connection, so the read takes no second one
  // from the pool while the write holds one, and with no row lock.
  const documentOn = siteStyleDocumentOn(ctx.services.ownCollections, slug);
  return {
    documentOn,
    styleNow: async () => siteStyleOfDocument(await documentNow(), defaults),
    definitions: async transaction => {
      if (transaction !== undefined) {
        return siteDefinitionsOfDocument(
          await documentOn(transaction),
          defaults
        );
      }
      // Inside a field rewrite's transaction, the definitions it read before
      // opening it: read through the pool there, they would wait on the
      // connection the rewrite holds. Imported at call time: server-only.
      const { siteDefinitionsInScope } = await import(
        "../host-rewrite/rewrite-scope"
      );
      return siteDefinitionsInScope(async () =>
        siteDefinitionsOfDocument(await documentNow(), defaults)
      );
    },
  };
}

/**
 * What the component-delete rewrite reads the installed site through: the
 * live registries, the Direct API (through the SDK, at call time), the
 * Layouts, and the usage index as a hint.
 */
export function rewriteInstallFor(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  opts: PageBuilderOptions,
  composition: CompositionSetup,
  /** The usage indexes' reconciler, read per call: `init` registers it. */
  reconcile: () => CommittedWriteReconciler | undefined
): RewriteInstall {
  // The booted instance through the SDK, the plugin's stable surface, imported
  // at call time for the reason `defaultLayoutDeps` gives.
  const nextly = async (): Promise<RewriteDirectApi> => {
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    return getCachedNextly();
  };
  return {
    db: ctx.db,
    dialect: ctx.dialect,
    site: {
      nextly,
      collectionSlugs: () => registeredCollectionSlugs(ctx),
      resolveCollection: slug =>
        ctx.services.collections.getCollection(slug, undefined as never),
      singles: () => singlesDeclaringBlocks(ctx),
      locales: () =>
        ctx.config.localization?.locales.map(locale => locale.code) ?? [],
      defaultLocale: () => ctx.config.localization?.defaultLocale,
      layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
      // A document whose field groups hold no blocks field is no host: its
      // field groups' values are stored apart, where no copy can be.
      fieldGroups: siteFieldGroups(ctx, nextly),
    },
    hints: async componentId => {
      const found = await composition.hostsOf?.placing([componentId]);
      const seen = new Set<string>();
      const hints: { slug: string; id: string }[] = [];
      for (const host of found?.hosts ?? []) {
        // Collection entries only: the walk after the hints reads every
        // Single anyway, and a hint names an entry by its id.
        if (host.single === true) continue;
        const key = `${host.slug}\u001F${host.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push({ slug: host.slug, id: host.id });
      }
      return hints;
    },
    store: composition.store,
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    // The site's blocks, as the composition judges them.
    blocks: composition.blocks,
    // The plugin's own service, so a converted document's history names the
    // Page Builder beside the person who deleted the component.
    rewriteField: (request, as) =>
      ctx.services.collections.rewriteField(request, as),
    // The site's definitions read before the rewrite opens its transaction,
    // and each copy as it is decided, for the validation core runs inside it
    // (`host-rewrite/rewrite-scope`).
    rewriteScope: async (field, run) => {
      const { withRewriteScope } = await import(
        "../host-rewrite/rewrite-scope"
      );
      const scope = {
        siteDefinitions: await composition.siteDefinitions?.(),
        current: null as { field: string; stored: unknown } | null,
      };
      return withRewriteScope(scope, () =>
        run(stored => {
          scope.current = { field, stored };
        })
      );
    },
    // A field rewrite runs no save hooks, the usage indexes' among them, so
    // each rewritten document is brought in line once the rewrite commits.
    afterRewrite: async document => {
      await reconcile()?.({
        slug: document.slug,
        documentId: document.id,
        nextly: await nextly(),
      });
    },
  };
}

/**
 * A written document's pending working draft, read as the system, or `null`
 * where there is none: what a write's hold judgement compares with beside
 * the live row its hook is handed. A Single's hooks name it `single:<slug>`.
 */
async function storedDraftOf(at: {
  readonly collection: string;
  readonly id: string | undefined;
}): Promise<unknown> {
  const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
  const nextly: RewriteDirectApi = await getCachedNextly();
  const single = at.collection.startsWith(SINGLE_HOOK_NAMESPACE)
    ? at.collection.slice(SINGLE_HOOK_NAMESPACE.length)
    : undefined;
  try {
    const row =
      single !== undefined
        ? await nextly.findSingle({
            slug: single,
            createIfMissing: false,
            draft: true,
            status: "all",
            depth: 0,
            overrideAccess: true,
          })
        : at.id === undefined
          ? null
          : await nextly.findByID({
              collection: at.collection,
              id: at.id,
              draft: true,
              status: "all",
              depth: 0,
              overrideAccess: true,
            });
    const pending = row as { _isWorkingDraft?: unknown } | null;
    return pending?._isWorkingDraft === true ? pending : null;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Every live Single whose declaration holds a blocks field, with its fields
 * and its localization master switch, or `undefined` when the registry cannot
 * be read whole. Orphaned code-first rows are left out: removing a code-first
 * Single from config leaves its registry row readable until someone runs the
 * destructive cleanup, and that row says nothing about content that exists.
 *
 * PAGED and exhausted, for the reason the collection listing is: a short read
 * leaves out a Single a later page holds, and the usage index would call
 * itself whole without having walked it.
 */
export async function singlesDeclaringBlocks(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<SingleToWalk[] | undefined> {
  const declared = declaredSingleSlugs(ctx);
  const configured = configuredSingles(ctx);
  const localizedSite = (ctx.config.localization?.locales.length ?? 0) > 0;
  const found: SingleToWalk[] = [];
  for await (const rows of singlesRegistryPages(ctx)) {
    if (rows === UNREADABLE_PAGE) return undefined;
    const page = singlesDeclaringBlocksIn(rows, declared);
    if (page === undefined) return undefined;
    for (const single of page) {
      found.push(
        singleToWalk(single, configured.get(single.slug), localizedSite)
      );
    }
  }
  return found;
}

/**
 * One live Single holding blocks, read as {@link singlesDeclaringBlocks} reads
 * each, from the Singles registry, which creates nothing; `undefined` when no
 * live Single of that slug holds a blocks field. Refused when the registry's
 * answer cannot be read, so a save it cannot place is a maintenance failure
 * rather than a Single silently left out.
 */
export async function liveSingle(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  slug: string
): Promise<SingleToWalk | undefined> {
  const listed: unknown = await ctx.services.singles.list({
    slugAllowlist: [slug],
    limit: 1,
  });
  const rows = (listed as { data?: unknown }).data;
  const page = Array.isArray(rows)
    ? singlesDeclaringBlocksIn(rows, declaredSingleSlugs(ctx))
    : undefined;
  if (page === undefined) {
    throw new Error(
      `[page-builder] the Singles registry could not be read for "${slug}", so its usage could not be recorded`
    );
  }
  const single = page.find(entry => entry.slug === slug);
  if (single === undefined) return undefined;
  const localizedSite = (ctx.config.localization?.locales.length ?? 0) > 0;
  return singleToWalk(single, configuredSingles(ctx).get(slug), localizedSite);
}

/** The Singles declared in code, by slug, as the site's config states them. */
function configuredSingles(ctx: {
  config?: { singles?: unknown };
}): ReadonlyMap<string, { fields?: unknown; localized?: unknown }> {
  const singles = ctx.config?.singles;
  const bySlug = new Map<string, { fields?: unknown; localized?: unknown }>();
  if (!Array.isArray(singles)) return bySlug;
  for (const single of singles) {
    const slug = (single as { slug?: unknown } | null)?.slug;
    if (typeof slug === "string") {
      bySlug.set(slug, single as { fields?: unknown; localized?: unknown });
    }
  }
  return bySlug;
}

/**
 * The site's field groups, read once per walk from the registry through the
 * Direct API, with the code's declarations for a slug the registry does not
 * hold; nothing at all where the registry cannot be read to the end
 * (`host-rewrite/field-groups`).
 */
function siteFieldGroups(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  nextly: () => Promise<Pick<RewriteDirectApi, "fieldGroups">>
): () => Promise<(slug: string) => { readonly fields?: unknown } | undefined> {
  const inCode = declaredFieldGroups(ctx);
  return () =>
    readSiteFieldGroups({
      page: async (offset, limit) =>
        (await nextly()).fieldGroups.find({ limit, offset }),
      inCode,
      warn: (message, meta) => ctx.logger.warn(message, meta),
    });
}

/**
 * The field groups the site declares in code, by slug, as its config states
 * them.
 */
export function declaredFieldGroups(ctx: {
  config?: { fieldGroups?: unknown };
}): (slug: string) => { readonly fields?: unknown } | undefined {
  const groups = ctx.config?.fieldGroups;
  const bySlug = new Map<string, { readonly fields?: unknown }>();
  if (Array.isArray(groups)) {
    for (const group of groups) {
      const slug = (group as { slug?: unknown } | null)?.slug;
      if (typeof slug === "string") {
        bySlug.set(slug, group as { readonly fields?: unknown });
      }
    }
  }
  return slug => bySlug.get(slug);
}

/**
 * The live Singles on one registry page whose declaration holds a blocks
 * field; `undefined` when a live row carries no readable slug, since a Single
 * that cannot be named cannot be read.
 */
function singlesDeclaringBlocksIn(
  rows: readonly unknown[],
  declared: ReadonlySet<string> | undefined
): { slug: string; fields?: unknown }[] | undefined {
  const found: { slug: string; fields?: unknown }[] = [];
  for (const row of rows) {
    if (isOrphanedSingle(row, declared)) continue;
    const slug = (row as { slug?: unknown } | null)?.slug;
    if (typeof slug !== "string") return undefined;
    const fields = (row as { fields?: unknown }).fields;
    const reach = blocksFieldReach({ fields });
    if (reach.fields.length > 0 || reach.unreachable) {
      found.push({ slug, fields });
    }
  }
  return found;
}

/** The registry each page builder this process made holds. */
export const sitesBlocks: WeakMap<PluginDefinition, BlockRegistryReader> =
  new WeakMap<PluginDefinition, BlockRegistryReader>();

/**
 * The blocks the page builder `plugin` holds for its site: what a route
 * rendering that site's pages takes as its `blocks` when one process serves
 * several sites. A route serving the process's one site needs nothing: it
 * reads that site's blocks itself. Refused for a plugin that is not a page
 * builder.
 *
 * Read on each lookup from the page builder itself where it started in this
 * module copy, else from the registry the last boot here started (a dev
 * server's config reload makes a new definition and runs no `init`). A
 * route reads the started site through the instance where neither exists:
 * a production build bundles the plugin into each route, and the route's
 * copy never starts. Refused, never answered empty, while no site has
 * started, since every block would otherwise draw as an unknown one.
 *
 * ```ts
 * export const builder = pageBuilder();
 * // app/[...slug]/page.tsx
 * createBlocksPage({ ..., blocks: blocksOf(builder) });
 * ```
 *
 * @experimental Settles with the per-site block registry.
 */
export function blocksOf(plugin: PluginDefinition): BlockRegistryReader {
  const own = sitesBlocks.get(plugin);
  if (own === undefined) {
    throw new Error(
      "[page-builder] blocksOf() takes a page builder made with pageBuilder(); " +
        `"${plugin.name}" is not one.`
    );
  }
  // Marked, so a route reads the started site through the instance where
  // this page builder did not start in its module copy.
  return Object.assign(runningBlocks(own), {
    [SITE_COPY]: { started: () => runningRegistry(own) !== undefined },
  });
}

/** The named queries each page builder this process made registers. */
export const sitesQueries: WeakMap<PluginDefinition, NamedQueryLookup> =
  new WeakMap<PluginDefinition, NamedQueryLookup>();

/**
 * The named queries the page builder `plugin` registers for its site, run
 * functions included: what a route rendering that site's pages takes as its
 * `namedQueries`. Bound to that one page builder, so two sites served from
 * one process never resolve each other's queries. Nothing for a plugin that
 * is not a page builder.
 *
 * Read from the page builder itself; a route reads the started site's
 * through the instance where this page builder did not start in its module
 * copy, for the reason {@link blocksOf} gives, since the queries plugins
 * declare are added as the site starts. Elsewhere, before any start, the
 * site's own queries.
 *
 * ```ts
 * export const builder = pageBuilder({ namedQueries: [upcomingEvents] });
 * // app/[...slug]/page.tsx
 * createBlocksPage({ ..., namedQueries: namedQueriesOf(builder) });
 * ```
 *
 * @experimental
 */
export function namedQueriesOf(plugin: PluginDefinition): NamedQueryLookup {
  const own = sitesQueries.get(plugin);
  const blocks = sitesBlocks.get(plugin);
  if (own === undefined || blocks === undefined) {
    return { definitionOf: () => undefined };
  }
  // Marked as `blocksOf` is: a route reads the started site's queries,
  // plugins' among them, where this page builder did not start here.
  return {
    definitionOf: name => own.definitionOf(name),
    [SITE_COPY]: { started: () => hasStarted(blocks) },
  } as NamedQueryLookup;
}
