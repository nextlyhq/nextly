/**
 * The stored site style as the editor reads it, and who may.
 *
 * The canvas and the inspector cannot draw a block without the site's tokens,
 * fonts, classes and breakpoints. The `site-style` Single holds them, and its
 * own read needs Design's `read-site-style`; a rule on the Single could only
 * narrow that, never widen it, because core composes the action's permission
 * with the target's rule. So an author who may edit a page but not the site's
 * design would open an editor whose canvas cannot draw anything. This route is
 * the editor's one read of the style instead, and it answers to whoever may
 * edit something the builder opens.
 *
 * ## Who it answers
 *
 * A signed-in caller who holds `read-site-style`, or who may UPDATE something
 * the builder edits: the pages, the components (in the store they live in),
 * any other collection or live Single declaring a blocks field the builder
 * opens (a removed code-first Single's leftover registry row does not count).
 * Asked through `ctx.caller.can`, the framework's own answer for a session or
 * an API key, before anything is read. The update questions are type-level
 * (`anyEntry`): an update rule limited to the entries a row filter matches
 * counts, since such an author may edit some of those documents. Nobody
 * else: not an anonymous caller, and not one who may only read those
 * documents.
 *
 * ## What it answers
 *
 * The four stored sections exactly as the Single holds them and nothing more,
 * read past the Single's own permission. Every published page compiles the
 * same sections into the CSS a visitor is served, so they are not a secret
 * from someone allowed to edit what those pages show. The usage index and
 * where-used counts are not part of the answer. Writes are untouched: they go
 * through the Single and need `update-site-style`.
 *
 * @module site-style-route
 */
import {
  getCachedNextly,
  NextlyError,
  respondDoc,
  type PluginRouteCanOptions,
} from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "./collections/components";
import { PAGES_SLUG } from "./collections/pages";
import { declaredSingleSlugs, isOrphanedSingle } from "./declared-singles";
import {
  SITE_STYLE_ROUTE_PATH,
  type StoredSiteStyle,
} from "./library-contract";
import type { ComponentStore } from "./library-route";
import { builderBlocksFields } from "./nested-blocks-fields";
import {
  registryRecords,
  type PageCollectionsContext,
} from "./pages-search-route";
import {
  readStoredSiteStyleVersioned,
  SITE_STYLE_SLUG,
  type SiteStyleReader,
} from "./site-style-storage";
import { bootedSpacingModeReader } from "./spacing-mode-booted";

/**
 * What the route reads of the plugin route context: the caller, the plugin's
 * resolved slugs, and the two registry listings that say which documents
 * declare a blocks field. Structural, so a test can supply it without a server.
 */
export interface SiteStyleRouteContext extends PageCollectionsContext {
  readonly self: PageCollectionsContext["self"] & {
    readonly singles: Readonly<Record<string, string | undefined>>;
  };
  readonly caller: {
    can(
      action: string,
      resource: string,
      options?: PluginRouteCanOptions
    ): Promise<boolean>;
  } | null;
  /** The app's configuration, for which code-first Singles it still declares. */
  readonly config: { readonly singles?: unknown };
  readonly services: PageCollectionsContext["services"] & {
    readonly singles: {
      list(options: { offset: number; limit: number }): Promise<unknown>;
    };
  };
}

/** How many Singles one page of the registry listing asks for. */
const SINGLES_PAGE_SIZE = 100;

/** The most pages of Singles walked, so a listing that never ends cannot hold a read open. */
const SINGLES_PAGES_MAX = 50;

/** The slug a registry record names, when it names one. */
function slugOf(record: unknown): string | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const slug = (record as { slug?: unknown }).slug;
  return typeof slug === "string" && slug !== "" ? slug : undefined;
}

/**
 * A collection or live Single that declares a blocks field the builder opens:
 * its slug, its label when the registry gives one, and where each such field
 * sits on its documents.
 */
export interface BuilderDocumentType {
  readonly slug: string;
  /** The registry's label for it, when it has a usable one. */
  readonly label: string | undefined;
  /**
   * Each blocks field the builder opens on it, by its declared path:
   * `hero.body` inside a group, `sections.body` inside a repeater's rows,
   * whose value is stored once per row (read with `storedValuesAt`).
   */
  readonly paths: readonly string[];
  /**
   * The paths of `paths` outside every repeater (`hero.body`): the ones
   * core's stored read of a single field can name. A reader that asks for a
   * field by its path, rather than reading the whole document, asks only
   * these.
   */
  readonly fixedPaths: readonly string[];
}

/**
 * A registry record as a document type the builder opens, or `undefined` when
 * it declares no blocks field the builder opens or names no slug. One reading,
 * so the access gate below and the shared-style rescan agree on which
 * documents the builder edits.
 */
function builderTypeOf(record: unknown): BuilderDocumentType | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const slug = slugOf(record);
  const fields = builderBlocksFields(record);
  const paths = fields.map(field => field.path);
  if (slug === undefined || paths.length === 0) return undefined;
  const label = (record as { label?: unknown }).label;
  return {
    slug,
    label: typeof label === "string" && label.trim() !== "" ? label : undefined,
    paths,
    // Derived from the same walk: a field inside a row has no one path.
    fixedPaths: fields.filter(field => !field.inRow).map(field => field.path),
  };
}

/**
 * Whether a registry row is a Single the app has now: built in the admin, or
 * declared in code and still in configuration. A removed code-first Single's
 * row outlives it, and so do role grants on its permission, so a former editor
 * of it must not pass for an editor of something the builder opens. Where the
 * configuration's Singles cannot be read, no code-first row is taken as live.
 */
function isLiveSingle(
  row: unknown,
  declared: ReadonlySet<string> | undefined
): boolean {
  if (declared === undefined) {
    return (row as { source?: unknown } | null)?.source !== "code";
  }
  return !isOrphanedSingle(row, declared);
}

/** The live Singles on one page of the listing that the builder opens. */
export function builderSinglesIn(
  rows: readonly unknown[],
  declared: ReadonlySet<string> | undefined
): BuilderDocumentType[] {
  return rows
    .filter(row => isLiveSingle(row, declared))
    .map(builderTypeOf)
    .filter((type): type is BuilderDocumentType => type !== undefined);
}

/** Every live Single that holds a blocks field the builder opens. */
export async function singlesTheBuilderOpens(
  ctx: Pick<SiteStyleRouteContext, "config" | "services">
): Promise<BuilderDocumentType[]> {
  const types: BuilderDocumentType[] = [];
  const declared = declaredSingleSlugs(ctx);
  for (let page = 0; page < SINGLES_PAGES_MAX; page += 1) {
    const listed = await ctx.services.singles.list({
      offset: page * SINGLES_PAGE_SIZE,
      limit: SINGLES_PAGE_SIZE,
    });
    const { data, total } = listed as { data?: unknown; total?: unknown };
    if (!Array.isArray(data) || data.length === 0) break;
    types.push(...builderSinglesIn(data, declared));
    const read = page * SINGLES_PAGE_SIZE + data.length;
    if (typeof total !== "number" || read >= total) break;
  }
  return types;
}

/** Every collection that declares a blocks field the builder opens. */
export async function collectionsTheBuilderOpens(
  ctx: PageCollectionsContext
): Promise<BuilderDocumentType[]> {
  return builderCollectionsIn(await registryRecords(ctx));
}

/**
 * The collections among registry records that declare a blocks field the
 * builder opens: one reading for the pooled listing above and for a read of
 * the registry on a write's transaction, so both name the same documents.
 */
export function builderCollectionsIn(
  records: readonly unknown[]
): BuilderDocumentType[] {
  return records
    .map(builderTypeOf)
    .filter((type): type is BuilderDocumentType => type !== undefined);
}

/** The app's configuration, as far as its languages go. */
export interface LocalizedConfig {
  readonly localization?: { readonly locales: readonly unknown[] };
}

/**
 * The site's configured languages, by code: a locale is a code or an entry
 * carrying one. Empty for a site with no languages configured.
 */
export function siteLocales(config: LocalizedConfig): string[] {
  return (config.localization?.locales ?? []).flatMap(locale => {
    const code =
      typeof locale === "string"
        ? locale
        : (locale as { code?: unknown } | null)?.code;
    return typeof code === "string" ? [code] : [];
  });
}

/**
 * Where the site's block documents may live: every collection and live Single
 * holding a blocks field the builder opens, the Singles with the form paths of
 * those fields, and the site's configured languages. The survey this route
 * admits editors by, so a reader asking where blocks live gets the same
 * answer.
 */
export async function blocksSurvey(
  ctx: PageCollectionsContext &
    Pick<SiteStyleRouteContext, "services"> & {
      readonly config: SiteStyleRouteContext["config"] & LocalizedConfig;
    }
): Promise<{
  collections: string[];
  singles: { slug: string; paths: readonly string[] }[];
  locales: string[];
}> {
  return {
    // The site's languages, since a Single's document may exist in one of
    // them alone.
    locales: siteLocales(ctx.config),
    collections: (await collectionsTheBuilderOpens(ctx)).map(type => type.slug),
    singles: (await singlesTheBuilderOpens(ctx)).map(({ slug, paths }) => ({
      slug,
      paths,
    })),
  };
}

/**
 * Whether this caller may read the stored site style through the editor.
 *
 * Asked in order of how often it answers: Design's read, then the plugin's
 * own pages and components, which need no listing; only a caller refused all
 * of those has the registry walked for the other documents the builder opens.
 * Each question stops at the first yes.
 */
export async function mayReadSiteStyle(
  ctx: SiteStyleRouteContext,
  store: Pick<ComponentStore, "collection">
): Promise<boolean> {
  const { caller } = ctx;
  // Nobody identified may not; the route is authenticated, so the dispatcher
  // refuses an anonymous caller first, but `null` must never read as allowed.
  if (caller === null) return false;
  const style = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  if (await caller.can("read", style)) return true;
  const known = [
    ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    store.collection ??
      ctx.self.collections[COMPONENTS_SLUG] ??
      COMPONENTS_SLUG,
  ];
  const asked = new Set<string>();
  const mayUpdate = async (slug: string): Promise<boolean> => {
    if (asked.has(slug)) return false;
    asked.add(slug);
    // A type-level question: may this caller edit this kind of document at
    // all? Asked with `anyEntry`, so an author whose update rule limits them
    // to the entries a row filter matches counts as one who may edit: plain
    // `can` would answer no, having no entry to apply the filter to. The
    // filter is neither applied nor bypassed here; only admission is decided,
    // and every write the author makes is still judged on its entry.
    return caller.can("update", slug, { anyEntry: true });
  };
  for (const slug of known) if (await mayUpdate(slug)) return true;
  for (const { slug } of await collectionsTheBuilderOpens(ctx)) {
    if (await mayUpdate(slug)) return true;
  }
  for (const { slug } of await singlesTheBuilderOpens(ctx)) {
    if (await mayUpdate(slug)) return true;
  }
  return false;
}

/**
 * The stored site style for the editor, once the caller is admitted.
 *
 * The permission is decided FIRST and refuses before anything is read.
 */
export async function readSiteStyleForEditor(
  ctx: SiteStyleRouteContext,
  nextly: SiteStyleReader,
  store: Pick<ComponentStore, "collection">
): Promise<StoredSiteStyle> {
  if (!(await mayReadSiteStyle(ctx, store))) {
    throw NextlyError.forbidden({
      logContext: { reason: "site-style-read-needs-editing-rights" },
    });
  }
  const { stored, rev } = await readStoredSiteStyleVersioned({
    nextly,
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    // Past the Single's own permission: the caller was admitted above.
    overrideAccess: true,
    // The model of the booted instance when the route's reader has no plugin
    // services; this route is server-only, so it may import that read.
    bootedReader: bootedSpacingModeReader,
  });
  // The version the same read gave, so the editor's saves made from this
  // answer are refused rather than written over a save made in between.
  return rev === undefined ? stored : { ...stored, _rev: rev };
}

/**
 * The route declaration. Authenticated (no `public`), and no
 * `requiredPermission`: one permission cannot say "Design's read, or the
 * right to edit something the builder opens", so the handler asks.
 */
export function siteStyleRoute(
  store: Pick<ComponentStore, "collection"> = {}
): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: SiteStyleRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: SITE_STYLE_ROUTE_PATH,
    handler: async (_req, ctx) =>
      respondDoc(
        await readSiteStyleForEditor(ctx, await getCachedNextly(), store)
      ),
  };
}
