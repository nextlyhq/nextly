/**
 * Pages and documents: the addresses pages and collection entries are served
 * at, held in the address store in each save's own transaction and settled by
 * the start-up passes, and the routes for a publish's readiness, the relation
 * control's entries, the editor's page search, a page's address, the Pages
 * panel's writes and the pages collection's name.
 */
import { NextlyError, type PluginRoute } from "@nextlyhq/plugin-sdk";

import { version as PLUGIN_VERSION } from "../../package.json";
import {
  backfillPageClaims,
  publishedPagesInTransaction,
  type PagesInTransactionRead,
  type PagesReader,
} from "../address-claims/backfill";
import { committedClaims, type Tx } from "../address-claims/claim-store";
import { contentAddressService } from "../address-claims/content-addresses";
import { entryDesignReads } from "../address-claims/design-reads";
import { ENTRY_SLUG_FIELD } from "../address-claims/entry-claims";
import {
  collectionClaimInputs,
  registerEntryAddressClaims,
  releaseUndeclared,
  settleEntryClaimsAtStart,
  type EntryClaimsDeps,
} from "../address-claims/entry-claims-hook";
import { claimLocales, pageClaims } from "../address-claims/page-claims";
import {
  describeFor,
  registerPageAddressClaims,
} from "../address-claims/page-claims-hook";
import {
  runAddressStartup,
  sortedPairs,
  startMarkStore,
  type AddressedCollection,
  type RowsState,
} from "../address-claims/start-pass";
import { addressWaitingRoute } from "../address-claims/waiting-report-route";
import { mayBeTemplated } from "../collection-reach";
import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { PAGES_SLUG } from "../collections/pages";
import { TEMPLATES_SLUG } from "../collections/templates";
import { entriesRoute } from "../entries-route";
import { pageCollectionRoute } from "../layout-choices-route";
import { pageAddressRoute, pagesSearchRoute } from "../pages-search-route";
import { pagesWriteRoutes } from "../pages-write-route";
import {
  publishDependenciesRoute,
  publishReadinessRoute,
} from "../publish-readiness";
import { addressSegments } from "../templates/template-addresses";
import {
  storedAddressesReader,
  templateCollectionProblem,
} from "../templates/template-guard";
import {
  storedAddressOf,
  storedAddressProblem,
  TEMPLATE_ADDRESS_FIELD,
} from "../templates/template-routing";

import type { InitContext } from "./install-context";
import { componentStoreOf, publishReadinessSetup } from "./options";
import type { Definition, DefinitionState } from "./state";

/** The newest-first read of one row, for a collection's {@link RowsState}. */
const NEWEST_ROW = {
  sort: { field: "updatedAt", direction: "desc" as const },
  pagination: { limit: 1 },
  select: { id: true, updatedAt: true },
  depth: 0 as const,
};

/** A collection's rows from a {@link NEWEST_ROW} read of it. */
function rowsStateOf(found: {
  readonly data: readonly unknown[];
  readonly pagination: { readonly total: number };
}): RowsState {
  const newest = (found.data[0] as { updatedAt?: unknown } | undefined)
    ?.updatedAt;
  return {
    total: found.pagination.total,
    // A driver answers a timestamp as a Date, or as text or a number where
    // the column keeps it so.
    newest:
      newest instanceof Date
        ? newest.toISOString()
        : typeof newest === "string" || typeof newest === "number"
          ? String(newest)
          : null,
  };
}

/**
 * Who holds each address: the page claims and the entry claims, kept in the
 * save's own transaction, the start-up passes the boot leaves running, and
 * the content address service the site's content route reads.
 */
export function installAddressClaims(ctx: InitContext, def: Definition): void {
  const { opts, state, templateAddresses, declaredPaths } = def;
  // The address store's collection, as the address claims reach it.
  const addressClaims = {
    services: ctx.services,
    slug: ctx.self.collections[ADDRESS_CLAIMS_SLUG] ?? ADDRESS_CLAIMS_SLUG,
    dialect: ctx.dialect,
  };
  // A page's address, and its paginated list's later pages, held in the
  // address store in the save's own transaction, so two documents never
  // hold one address whichever path saved them.
  const claimsStore = addressClaims;
  const pagesSlug = ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG;
  const siteLocales = (): readonly string[] =>
    claimLocales(
      ctx.config.localization?.locales.map(locale => locale.code) ?? [],
      ctx.config.localization?.defaultLocale
    );
  state.pageClaimsInit += 1;
  state.pageClaimsBackfilled = false;
  const claimsInit = state.pageClaimsInit;
  // On the save's own connection, so naming a refusal takes no second
  // connection from the pool while the save holds one.
  const readPage = async (
    tx: Tx,
    id: string
  ): Promise<Readonly<Record<string, unknown>> | null> => {
    try {
      const found =
        await ctx.services.ownCollections.findEntryByIdInTransaction(
          tx,
          pagesSlug,
          id
        );
      return found;
    } catch (error) {
      if (NextlyError.isNotFound(error)) return null;
      throw error;
    }
  };
  // The Pages collection read on a write's transaction, for the walk a
  // save makes over every published page while the start-up pass runs,
  // whether a page's save or an entry's.
  const readPagesOn: PagesInTransactionRead = (on, options, opts) =>
    ctx.services.ownCollections.listEntriesInTransaction(
      on,
      pagesSlug,
      options,
      opts
    );
  registerPageAddressClaims(ctx.hooks, {
    pages: pagesSlug,
    claims: claimsStore,
    locales: siteLocales,
    readPage,
    ...(opts.pagePreviewPath === undefined
      ? {}
      : { pathTemplate: opts.pagePreviewPath }),
    backfillDone: () => state.pageClaimsBackfilled,
    // Hook-free and as the system, as the pages' start-up pass reads
    // them, on the save's own transaction: a save holding the pool's
    // last connection never waits for a second one.
    publishedPages: tx => publishedPagesInTransaction(readPagesOn, tx),
  });
  // The pages `ids` as stored, each matched by its id exactly (a database
  // may compare loosely): their own columns, no relationship expanded,
  // past every read hook, as the pages' pass judges their claims.
  const pagesWithIds = (rows: readonly unknown[], ids: readonly string[]) =>
    (rows as Readonly<Record<string, unknown>>[]).filter(
      row =>
        (typeof row.id === "string" || typeof row.id === "number") &&
        ids.includes(String(row.id))
    );
  const pageClaimsBackfill = async () => {
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    const complete = await backfillPageClaims({
      pages: pagesSlug,
      claims: claimsStore,
      locales: siteLocales(),
      ...(opts.pagePreviewPath === undefined
        ? {}
        : { pathTemplate: opts.pagePreviewPath }),
      nextly: (await getCachedNextly()) as unknown as PagesReader,
      // With no row lock: the pass holds the page's claims lock, which a
      // save of the page takes before it commits, while a share lock
      // here would wait for a save holding the row that is itself
      // waiting for that claims lock. At depth 0: a page's claims follow
      // from its own columns, and expanding its relationships costs a
      // read per related document.
      readPage: async (tx, id) => {
        const found =
          await ctx.services.ownCollections.listEntriesInTransaction(
            tx,
            pagesSlug,
            {
              where: { id: { equals: id } },
              pagination: { limit: 1 },
              depth: 0,
            },
            { lock: "none" }
          );
        return pagesWithIds(found.data, [id])[0] ?? null;
      },
      readPages: async ids => {
        const found = await ctx.services.ownCollections.listEntries(pagesSlug, {
          where: { id: { in: [...ids] } },
          pagination: { limit: ids.length },
          depth: 0,
        });
        return pagesWithIds(found.data, ids);
      },
      withTransaction: work => ctx.services.collections.withTransaction(work),
      warn: (message, meta) => ctx.logger.warn(message, meta),
      current: () => claimsInit === state.pageClaimsInit,
    });
    // Only a pass that settled every page ends the saves' part in it: a
    // page it failed to read or claim is still unclaimed, so saves keep
    // claiming the pages in a list's way until a later boot's pass
    // finishes.
    if (complete && claimsInit === state.pageClaimsInit) {
      state.pageClaimsBackfilled = true;
    }
    return complete;
  };
  // Each collection's entries hold `<its address>/<slug>` while it and
  // the collection's template are published, in the save's transaction,
  // beside the pages, so an entry and a page never share an address.
  const templatesSlug = ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG;
  // Named as a page's save names the document in its way.
  const describeHolder = (tx: Tx) =>
    describeFor({ pages: pagesSlug, readPage }, tx);
  // A collection's record as the registry answers it, or null. Given a
  // write's transaction, read on that transaction's own connection, so
  // a save holding the pool's last connection never waits for another.
  const collectionRecord = async (
    slug: string,
    tx?: Tx
  ): Promise<Record<string, unknown> | null> => {
    try {
      return (await (tx === undefined
        ? ctx.services.collections.getCollection(slug, undefined as never)
        : ctx.services.collections.getCollectionInTransaction(
            tx,
            slug
          ))) as unknown as Record<string, unknown>;
    } catch (error) {
      if (NextlyError.isNotFound(error)) return null;
      throw error;
    }
  };
  const readStoredAddresses = storedAddressesReader(
    ctx.services.ownCollections,
    templatesSlug
  );
  // The entries of `collection` waiting for an address another document
  // holds, as last committed, for the template action's answer.
  state.waitingEntriesOf = async collection => {
    const waiting = new Set<string>();
    for (let page = 1; ; page += 1) {
      const { rows, total } = await committedClaims(
        claimsStore,
        {
          kind: { equals: "waiting" },
          holderCollection: { equals: collection },
        },
        { limit: 500, page }
      );
      for (const row of rows) {
        if (row.kind === "waiting" && row.holder?.collection === collection) {
          waiting.add(row.holder.id);
        }
      }
      if (rows.length === 0 || page * 500 >= total) return waiting.size;
    }
  };
  // Each published page among `rows`, with the claims it holds.
  const pageHoldings = (rows: readonly unknown[]) =>
    (rows as Readonly<Record<string, unknown>>[]).flatMap(row =>
      typeof row.id === "string" || typeof row.id === "number"
        ? [
            {
              id: String(row.id),
              ...pageClaims(row, siteLocales(), opts.pagePreviewPath),
            },
          ]
        : []
    );
  const claimsDeps: EntryClaimsDeps = {
    claims: claimsStore,
    addresses: templateAddresses,
    templates: templatesSlug,
    locales: siteLocales,
    describe: describeHolder,
    pages: pagesSlug,
    pagesBackfilled: () => state.pageClaimsBackfilled,
    // The registry's record says whether the collection's entries carry
    // a Draft/Published status, which a field named `status` does not.
    // Asked inside a write's transaction, so read on it.
    lifecycle: async (collection, tx) =>
      (await collectionRecord(collection, tx))?.status === true,
    // Hook-free and as the system, as the pages' start-up pass reads
    // them, on the write's own transaction: a write holding the pool's
    // last connection never waits for a second one. A page's slug is
    // unique, so one read of as many rows as slugs asked finds them all.
    pagesWithSlugs: async (slugs, tx) => {
      const found = await ctx.services.ownCollections.listEntriesInTransaction(
        tx,
        pagesSlug,
        {
          where: {
            status: { equals: "published" },
            slug: { in: [...slugs] },
          },
          pagination: { limit: slugs.length },
          depth: 0,
        }
      );
      return pageHoldings(found.data);
    },
    // The walk a page's save makes while the start-up pass runs (see
    // `publishedPagesInTransaction`), on the write's own transaction.
    publishedPagesOn: async function* (tx) {
      for await (const batch of publishedPagesInTransaction(readPagesOn, tx)) {
        yield pageHoldings(batch);
      }
    },
    // Hook-free and as the system, as the template guard reads it, so a
    // read hook cannot hide a template that serves entries.
    templateOf: async (collection, tx) => {
      const read = {
        where: { collection: { equals: collection } },
        pagination: { limit: 1 },
        // Asked on every save of a collection with a slug: the routing
        // columns alone, never the template's design.
        select: {
          id: true,
          collection: true,
          status: true,
          [TEMPLATE_ADDRESS_FIELD]: true,
        },
        depth: 0,
      };
      // On a save's transaction, its own connection: a save holding the
      // pool's last connection never waits for a second one.
      const found =
        tx === undefined
          ? await ctx.services.ownCollections.listEntries(templatesSlug, read)
          : await ctx.services.ownCollections.listEntriesInTransaction(
              tx,
              templatesSlug,
              read
            );
      const row = found.data[0] as Record<string, unknown> | undefined;
      if (row === undefined || row.collection !== collection) return null;
      const address = storedAddressOf(row[TEMPLATE_ADDRESS_FIELD]);
      return {
        published: row.status === "published",
        address: address === null ? null : addressSegments(address),
      };
    },
    // The entry's own design and the collection's template, judged for a
    // list split into pages, on the write's own transaction.
    ...entryDesignReads(ctx.services.ownCollections, templatesSlug),
    // The host's collection, read as the system, as a template's walk
    // reads it, but on the write's own transaction: a write holding the
    // pool's last connection never waits for a second one. One read
    // for every id asked, the columns an entry's address is judged by
    // alone; whether each is published is the hook's to judge.
    entriesWithIds: async (collection, ids, tx) => {
      const found = await ctx.services.collections.listEntriesInTransaction(
        tx,
        collection,
        {
          where: { id: { in: [...ids] } },
          pagination: { limit: ids.length },
          select: { id: true, [ENTRY_SLUG_FIELD]: true, status: true },
          depth: 0,
        }
      );
      return found.data;
    },
    storedAddresses: async () =>
      new Map(
        [...(await readStoredAddresses()).entries()].map(
          ([collection, address]) => [collection, addressSegments(address)]
        )
      ),
    // The page builder's own documents are pages, stores and
    // bookkeeping, never entries served under a template address; nor
    // is an entry of a collection the site's code declares that no
    // template may serve and no address in code names, such as another
    // plugin's private records. Known from the code alone, so a write to
    // one reads nothing (see `collection-reach`).
    neverServed: collection => !state.writeReach.mayServeEntries(collection),
    // The template guard's own judgement of which collections may have
    // one; a localized collection is refused an address. The same rule
    // `neverServed` asks of the code, asked of the registry's record.
    // Given a write's transaction, the registry is read on it.
    mayHaveTemplate: async (collection, tx) => {
      const own = new Set(Object.values(ctx.self.collections));
      return mayBeTemplated(
        collection,
        own.has(collection) ? null : await collectionRecord(collection, tx),
        own
      );
    },
    storedAddressProblem: (address, collection) =>
      storedAddressProblem(address, collection, {
        declared: declaredPaths,
      }),
    // The host's collection, read as the system, as `entriesWithIds`
    // reads it, on the write's own transaction: a write holding the
    // pool's last connection never waits for a second one.
    publishedEntries: async (collection, page, size, tx, lifecycle) => {
      const found = await ctx.services.collections.listEntriesInTransaction(
        tx,
        collection,
        {
          // Published only where the collection has a Draft/Published
          // lifecycle; without one every entry is live, whatever an
          // ordinary field named `status` holds. The hook judges each
          // row by the same test (`isPublished`).
          ...(lifecycle ? { where: { status: { equals: "published" } } } : {}),
          // `id` is unique and on every collection; `createdAt` is absent
          // where timestamps are off, and ties would let a paged walk skip
          // an entry at a batch's edge.
          sort: { field: "id", direction: "asc" },
          pagination: { limit: size, page },
          depth: 0,
        }
      );
      return found.data;
    },
  };
  // Whatever is declared in code: a collection created at runtime is
  // given its address on its template, at any time after start.
  registerEntryAddressClaims(ctx.hooks, claimsDeps);
  const passDeps = {
    ...claimsDeps,
    withTransaction: <T>(work: (tx: Tx) => Promise<T>) =>
      ctx.services.collections.withTransaction(work),
    warn: (message: string, meta: Record<string, unknown>) =>
      ctx.logger.warn(message, meta),
  };
  // Why a collection given an address in code cannot be served there, or
  // null when it can.
  const declaredAddressProblem = async (
    collection: string,
    own: ReadonlySet<string>
  ): Promise<string | null> => {
    const problem = await templateCollectionProblem(
      collection,
      collectionRecord,
      own
    );
    if (problem !== null) return problem;
    // One slug serves an entry in every language, as a page's does: a
    // localized collection's entries have a slug and a state in each,
    // which an address per language would have to follow.
    return (await collectionRecord(collection))?.localized === true
      ? `The collection "${collection}" is localized, and a localized collection's entries cannot be served under a template address yet.`
      : null;
  };
  const checkTemplateAddresses = async (
    storedAtStart: () => Promise<ReadonlyMap<string, string>>
  ) => {
    const own = new Set(Object.values(ctx.self.collections));
    const problems: string[] = [];
    // An address declared in code is compared with every other
    // collection's stored one: two collections may not share one. A
    // collection promoted into code taking over its own stored address
    // is no clash.
    const stored = await storedAtStart();
    for (const [collection, address] of declaredPaths) {
      for (const [other, held] of stored) {
        if (held === address && other !== collection) {
          problems.push(
            `"${collection}" is given the address "${address}" in code, which the collection "${other}" is already served at, set on its template in the admin. Each collection needs an address of its own: change one of them.`
          );
        }
      }
    }
    for (const collection of templateAddresses.keys()) {
      const problem = await declaredAddressProblem(collection, own);
      if (problem !== null) problems.push(problem);
    }
    if (problems.length > 0) {
      throw new Error(
        `[page-builder] templates.addresses cannot be used: ${problems.join(" ")}`
      );
    }
  };
  // Where the start-up passes record that the store is settled.
  const startMarks = startMarkStore(ctx.db, ctx.dialect);
  // Each collection given a template address, as the start's mark reads
  // it: read through the pool, before any pass's transaction opens. Its
  // entries' count and newest save are read here, the rest as the pass
  // reads it (`collectionClaimInputs`).
  const addressedCollection = async (
    collection: string
  ): Promise<AddressedCollection> => {
    const record = await collectionRecord(collection);
    let rows: RowsState | null = null;
    if (record !== null) {
      // Newest save where its entries keep one; how many, either way.
      const found = await ctx.services.collections.listEntries(
        collection,
        record.timestamps === false
          ? { pagination: { limit: 1 }, select: { id: true }, depth: 0 }
          : NEWEST_ROW,
        { as: "system" }
      );
      rows =
        record.timestamps === false
          ? { total: found.pagination.total, newest: null }
          : rowsStateOf(found);
    }
    return {
      slug: collection,
      // Asked of the claims' own deps, as the start-up pass asks them,
      // so whatever decides what its entries hold moves the mark.
      claims: await collectionClaimInputs(claimsDeps, collection),
      rows,
    };
  };
  state.beginAddressStart = () => {
    // The template addresses set in the admin, read once for the whole
    // start: by the check the boot waits for, and by every pass after it.
    // A template saved meanwhile settles its entries' claims in its own
    // transaction.
    let storedRead: Promise<ReadonlyMap<string, string>> | undefined;
    const storedAtStart = () => (storedRead ??= readStoredAddresses());
    const startDeps = {
      ...passDeps,
      storedAddresses: async () =>
        new Map(
          [...(await storedAtStart()).entries()].map(
            ([collection, address]) => [collection, addressSegments(address)]
          )
        ),
    };
    return {
      check: () => checkTemplateAddresses(storedAtStart),
      passes: () =>
        runAddressStartup({
          inputs: async () => {
            const stored = await storedAtStart();
            const addressed = [
              ...new Set([...declaredPaths.keys(), ...stored.keys()]),
            ].sort();
            const collections: AddressedCollection[] = [];
            for (const collection of addressed) {
              collections.push(await addressedCollection(collection));
            }
            return {
              plugin: PLUGIN_VERSION,
              slugs: [pagesSlug, templatesSlug, claimsStore.slug],
              locales: [...siteLocales()],
              pagePath: opts.pagePreviewPath ?? null,
              declared: sortedPairs(declaredPaths),
              stored: sortedPairs(stored),
              collections,
              pages: rowsStateOf(
                await ctx.services.ownCollections.listEntries(pagesSlug, {
                  ...NEWEST_ROW,
                  where: { status: { equals: "published" } },
                })
              ),
              templates: rowsStateOf(
                await ctx.services.ownCollections.listEntries(
                  templatesSlug,
                  NEWEST_ROW
                )
              ),
              claims: await ctx.services.ownCollections.count(claimsStore.slug),
            };
          },
          mark: startMarks,
          pages: pageClaimsBackfill,
          sweep: () => releaseUndeclared(startDeps),
          entries: () => settleEntryClaimsAtStart(startDeps),
          skipped: () => {
            if (claimsInit === state.pageClaimsInit)
              state.pageClaimsBackfilled = true;
          },
          current: () => claimsInit === state.pageClaimsInit,
          warn: (message, meta) => ctx.logger.warn(message, meta),
        }),
    };
  };
  state.contentAddresses = contentAddressService({
    claims: claimsStore,
    // The site's default language, where a localized site names one.
    defaultLocale: () =>
      ctx.config.localization?.defaultLocale || siteLocales()[0] || "en",
    // The claims collection too: the start-up passes write it alone.
    collections: [
      pagesSlug,
      templatesSlug,
      claimsStore.slug,
      ...templateAddresses.keys(),
    ],
    holders: [pagesSlug, ...templateAddresses.keys()],
    // Served while its template stores an address and it may still have
    // a template: one that lost its `slug` field or became localized
    // is served nowhere, whatever claims its entries still hold.
    storesAddress: async collection =>
      ((await claimsDeps.templateOf(collection))?.address ?? null) !== null &&
      (await claimsDeps.mayHaveTemplate(collection)),
    // Listed for pre-rendering: those given an address in code, and
    // those whose template stores one.
    entryHolders: async () => [
      ...new Set([
        ...templateAddresses.keys(),
        ...(await readStoredAddresses()).keys(),
      ]),
    ],
    startup: () => state.addressStartup,
  });
}

/**
 * The start's work on the address store, once every plugin's collections are
 * registered: the check the boot waits for, then the passes it leaves
 * running.
 */
export async function startAddressClaims(
  state: DefinitionState
): Promise<void> {
  // A collection given a template address that cannot have a template
  // refuses to start, naming it: checked once every plugin's
  // collections are registered.
  const addressStart = state.beginAddressStart?.() ?? null;
  await addressStart?.check();
  // Existing pages' addresses, claimed in the background, then the
  // entries' under their collections' addresses, pages first, unless
  // nothing they follow from changed since the last start that settled
  // them (see `runAddressStartup`): the passes never throw, and a boot
  // is not held for them.
  if (addressStart !== null) {
    // Not awaited, so the boot is not held; the address listing joins it
    // instead (see the content address service), which is also how a
    // test waits for it.
    const startup = addressStart.passes().catch(() => undefined);
    state.addressStartup = startup;
    void startup.finally(() => {
      if (state.addressStartup === startup) state.addressStartup = null;
    });
  }
}

/** The routes pages and documents contribute, by name. */
export function routesForPages(def: Definition): {
  readonly publishReadiness: PluginRoute;
  readonly publishDependencies: PluginRoute;
  readonly entries: PluginRoute;
  readonly pagesSearch: PluginRoute;
  readonly pageAddress: PluginRoute;
  readonly addressWaiting: PluginRoute;
  readonly pagesWrite: PluginRoute[];
  readonly pageCollection: PluginRoute;
} {
  const { opts } = def;
  return {
    // What a publish would leave unpublished, asked by the editor before
    // it, and the offer's write: each chosen component or Layout
    // published as the author.
    publishReadiness: publishReadinessRoute(publishReadinessSetup(opts)),
    publishDependencies: publishDependenciesRoute(publishReadinessSetup(opts)),
    // The relation control's read: a collection's entries as `{ id, title }`,
    // for the collections a registered block prop names as relation targets,
    // read as the author asking.
    entries: entriesRoute(def.blocks),
    // The editor's page search: the site's pages (entries of collections
    // with a Page Builder field, the composition stores left out), by
    // title, read as the author asking.
    pagesSearch: pagesSearchRoute(componentStoreOf(opts), opts.pagePreviewPath),
    // Where one page is served as it is saved, for Settings' address
    // line, resolved as the search resolves each page's path.
    pageAddress: pageAddressRoute(componentStoreOf(opts), opts.pagePreviewPath),
    addressWaiting: addressWaitingRoute(),
    // The Pages panel's writes: create, duplicate, rename and delete a
    // page, each as the author asking, in exactly the collections the
    // search lists; and the New page dialog's read of what a new page
    // would get, its address shown where the search shows a page's.
    pagesWrite: pagesWriteRoutes(componentStoreOf(opts), opts.pagePreviewPath),
    // Which collection holds the pages, as renamed: the picker draws on
    // that collection's forms and no other.
    pageCollection: pageCollectionRoute(),
  };
}
