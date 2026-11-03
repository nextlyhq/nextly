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
 * an API key, before anything is read. Nobody else: not an anonymous caller,
 * and not one who may only read those documents.
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
import { getCachedNextly, NextlyError, respondDoc } from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "./collections/components";
import { PAGES_SLUG } from "./collections/pages";
import { declaredSingleSlugs, isOrphanedSingle } from "./declared-singles";
import {
  SITE_STYLE_ROUTE_PATH,
  type StoredSiteStyle,
} from "./library-contract";
import type { ComponentStore } from "./library-route";
import { editorBlocksFields } from "./nested-blocks-fields";
import {
  registryRecords,
  type PageCollectionsContext,
} from "./pages-search-route";
import {
  readStoredSiteStyle,
  SITE_STYLE_SLUG,
  type SiteStyleReader,
} from "./site-style-storage";

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
    can(action: string, resource: string): Promise<boolean>;
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

/** Whether a registry record declares a blocks field the builder opens. */
function opensInBuilder(record: unknown): boolean {
  if (typeof record !== "object" || record === null) return false;
  return editorBlocksFields(record).length > 0;
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

/** The slugs of the live Singles on one page of the listing that the builder opens. */
function builderSinglesIn(
  rows: readonly unknown[],
  declared: ReadonlySet<string> | undefined
): string[] {
  return rows
    .filter(row => isLiveSingle(row, declared) && opensInBuilder(row))
    .map(slugOf)
    .filter((slug): slug is string => slug !== undefined);
}

/** Every live Single that holds a blocks field the builder opens, by slug. */
async function singlesTheBuilderOpens(
  ctx: SiteStyleRouteContext
): Promise<string[]> {
  const slugs: string[] = [];
  const declared = declaredSingleSlugs(ctx);
  for (let page = 0; page < SINGLES_PAGES_MAX; page += 1) {
    const listed = await ctx.services.singles.list({
      offset: page * SINGLES_PAGE_SIZE,
      limit: SINGLES_PAGE_SIZE,
    });
    const { data, total } = listed as { data?: unknown; total?: unknown };
    if (!Array.isArray(data) || data.length === 0) break;
    slugs.push(...builderSinglesIn(data, declared));
    const read = page * SINGLES_PAGE_SIZE + data.length;
    if (typeof total !== "number" || read >= total) break;
  }
  return slugs;
}

/** Every collection that declares a blocks field the builder opens, by slug. */
async function collectionsTheBuilderOpens(
  ctx: SiteStyleRouteContext
): Promise<string[]> {
  const slugs: string[] = [];
  for (const record of await registryRecords(ctx)) {
    const slug = slugOf(record);
    if (slug !== undefined && opensInBuilder(record)) slugs.push(slug);
  }
  return slugs;
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
    // all? `can` answers a row-filtered update rule as "no", having no entry
    // to apply the filter to, so an author whose only update right is
    // row-filtered is not admitted here and needs `read-site-style`. A probe
    // that answers "yes" for such a rule, without applying it, belongs here.
    return caller.can("update", slug);
  };
  for (const slug of known) if (await mayUpdate(slug)) return true;
  for (const slug of await collectionsTheBuilderOpens(ctx)) {
    if (await mayUpdate(slug)) return true;
  }
  for (const slug of await singlesTheBuilderOpens(ctx)) {
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
  return readStoredSiteStyle({
    nextly,
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    // Past the Single's own permission: the caller was admitted above.
    overrideAccess: true,
  });
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
