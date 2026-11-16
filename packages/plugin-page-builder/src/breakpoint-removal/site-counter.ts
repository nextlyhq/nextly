/**
 * The dry run of a breakpoint removal on a real site: the shared document
 * walk and its system reader, the site's shared styles, and documents named
 * as the person asking.
 *
 * @module breakpoint-removal/site-counter
 * @experimental
 */
import type { DocumentLimits, NamedClass } from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "../collections/components";
import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import { titleFieldIn } from "../entries-route";
import { entryOf, findAsCaller, readSavedAsCaller } from "../entry-reads";
import { documentKeyOf, type HostAddress } from "../host-rewrite/contract";
import {
  siteDocuments,
  siteHostReader,
  type DocumentSite,
} from "../host-rewrite/site";
import { readingAsUser } from "../library-route";

import { countRemoval, type RemovalDryRun, type RemovalPlace } from "./dry-run";

/** How long one dry run may walk before it answers with what it has. */
const WALK_MS = 20_000;

/** The read naming a Single makes, as the person asking. */
export interface NamingDirectApi {
  findSingle(args: {
    slug: string;
    createIfMissing: false;
    depth: number;
    overrideAccess: false;
  }): Promise<unknown>;
}

/** What the installed plugin hands the counter. */
export interface RemovalSite {
  /** The shared walk's view of the site; `null` before the plugin is installed. */
  readonly site: () => (DocumentSite & { readonly layouts: string }) | null;
  /** The booted Direct API, for naming documents as the caller. */
  readonly naming: () => Promise<NamingDirectApi>;
  /** Where component definitions are stored. */
  readonly componentCollection: string | undefined;
  readonly limits: () => DocumentLimits;
}

/** The slugs each place is stored under, as renamed. */
interface PlaceSlugs {
  readonly pages: string;
  readonly components: string;
  readonly patterns: string;
  readonly layouts: string;
}

/** Which place a document is in. */
function placeOf(slugs: PlaceSlugs, host: HostAddress): RemovalPlace {
  if (host.kind === "single") return "singles";
  if (host.slug === slugs.pages) return "pages";
  if (host.slug === slugs.components) return "components";
  if (host.slug === slugs.patterns) return "patterns";
  if (host.slug === slugs.layouts) return "layouts";
  return "entries";
}

/**
 * What the caller knows each of one collection's entries by, for the ones
 * they may read: one list read as them, every status included, titled by the
 * rule every entries list names a row by. An entry the read does not return is
 * one they may not read.
 */
async function entryNamesAsCaller(
  site: Pick<DocumentSite, "resolveCollection">,
  ctx: Pick<PluginRouteContext, "caller">,
  slug: string,
  hosts: readonly HostAddress[]
): Promise<Map<string, string>> {
  const titleField = await titleFieldOf(site, slug);
  const ids = hosts.map(host => host.id ?? "");
  const names = new Map<string, string>();
  const select = {
    id: true,
    ...(titleField === undefined ? {} : { [titleField]: true }),
  };
  let page;
  try {
    page = await findAsCaller(ctx, {
      collection: slug,
      where: { id: { in: ids } },
      select,
      limit: ids.length,
    });
  } catch (error) {
    // A caller refused the whole collection may read none of its entries.
    if (NextlyError.isForbidden(error)) return names;
    throw error;
  }
  for (const row of page.items) {
    const entry = entryOf(row, titleField);
    if (entry === undefined) continue;
    names.set(
      documentKeyOf({ kind: "collection", slug, id: entry.id }),
      entry.title
    );
  }
  return names;
}

/** A collection's title field, as every entries list names its rows by. */
async function titleFieldOf(
  site: Pick<DocumentSite, "resolveCollection">,
  slug: string
): Promise<string | undefined> {
  const record = await site.resolveCollection(slug);
  return typeof record === "object" && record !== null
    ? titleFieldIn(record)?.name
    : undefined;
}

/**
 * Each entry of `hosts` by its title as saved, read as the caller: the list
 * read names a row by its live title, and a pending working draft may have
 * renamed it, which is what the editor shows. Asked only for the few a list
 * names, all at once rather than one after another; a Single is named by its
 * slug and is left out.
 */
export async function savedTitlesAsCaller(
  site: Pick<DocumentSite, "resolveCollection">,
  ctx: Pick<PluginRouteContext, "caller">,
  hosts: readonly HostAddress[],
  deadline: Date | undefined
): Promise<Map<string, string>> {
  const entries = hosts.filter(host => host.kind === "collection");
  const read = await Promise.all(
    entries.map(async host => {
      const titleField = await titleFieldOf(site, host.slug);
      // Looked at again once the collection is known: a read started past the
      // deadline would run on after the dry run has answered.
      if (deadline !== undefined && Date.now() >= deadline.getTime()) {
        return [documentKeyOf(host), undefined] as const;
      }
      const row = await readSavedAsCaller(ctx, {
        collection: host.slug,
        id: host.id ?? "",
        select: {
          id: true,
          ...(titleField === undefined ? {} : { [titleField]: true }),
        },
      });
      const title = row === null ? undefined : entryOf(row, titleField)?.title;
      return [documentKeyOf(host), title] as const;
    })
  );
  const titles = new Map<string, string>();
  for (const [key, title] of read)
    if (title !== undefined) titles.set(key, title);
  return titles;
}

/**
 * What the caller knows each of `hosts` by, for the ones they may read: each
 * collection's entries in one read, and each Single on its own.
 */
async function namesAsCaller(
  install: RemovalSite,
  site: Pick<DocumentSite, "resolveCollection">,
  ctx: Pick<PluginRouteContext, "caller">,
  hosts: readonly HostAddress[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const bySlug = new Map<string, HostAddress[]>();
  for (const host of hosts) {
    if (host.kind === "single") {
      const name = await singleNameAsCaller(await install.naming(), ctx, host);
      if (name !== null) names.set(documentKeyOf(host), name);
      continue;
    }
    const list = bySlug.get(host.slug) ?? [];
    list.push(host);
    bySlug.set(host.slug, list);
  }
  for (const [slug, list] of bySlug) {
    for (const [key, name] of await entryNamesAsCaller(site, ctx, slug, list)) {
      names.set(key, name);
    }
  }
  return names;
}

/**
 * Whether the caller may read a Single, named by its slug when they may: read
 * with their own identity, so the access gate that answers their every read
 * answers this one.
 */
async function singleNameAsCaller(
  nextly: NamingDirectApi,
  ctx: Pick<PluginRouteContext, "caller">,
  host: HostAddress
): Promise<string | null> {
  try {
    await nextly.findSingle({
      slug: host.slug,
      createIfMissing: false,
      depth: 0,
      ...(await readingAsUser(ctx)),
    });
    return host.slug;
  } catch (error) {
    if (NextlyError.isForbidden(error) || NextlyError.isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * What the person asking knows each of `hosts` by, by document key, for the
 * ones they may read, on the installed site: the names a removal's dry run
 * gives, so an undo names what it could not put back the same way.
 */
export async function nameDocumentsOnSite(
  install: RemovalSite,
  ctx: Pick<PluginRouteContext, "caller">,
  hosts: readonly HostAddress[]
): Promise<ReadonlyMap<string, string>> {
  const site = install.site();
  if (site === null || hosts.length === 0) return new Map();
  return namesAsCaller(install, site, ctx, hosts);
}

/**
 * What removing `removed` (id to label) would drop on the installed site, the
 * documents named as the person asking.
 */
export async function countRemovalOnSite(
  install: RemovalSite,
  ctx: Pick<PluginRouteContext, "caller"> & {
    readonly self: { collections: Record<string, string | undefined> };
  },
  removed: ReadonlyMap<string, string>,
  classes: readonly NamedClass[],
  /** When the walk stops and answers what it has; a dry run's own by default. */
  deadline: Date = new Date(Date.now() + WALK_MS)
): Promise<RemovalDryRun> {
  const site = install.site();
  if (site === null) {
    throw NextlyError.internal({
      logContext: { reason: "breakpoint-removal-not-installed" },
    });
  }
  const slugs: PlaceSlugs = {
    pages: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    components:
      install.componentCollection ??
      ctx.self.collections[COMPONENTS_SLUG] ??
      COMPONENTS_SLUG,
    patterns: ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
    layouts: site.layouts,
  };
  const documents = siteDocuments(site);
  return countRemoval(removed, {
    documents: () => documents(null),
    read: siteHostReader(site),
    placeOf: host => placeOf(slugs, host),
    namesFor: hosts => namesAsCaller(install, site, ctx, hosts),
    savedTitles: (hosts, deadline) =>
      savedTitlesAsCaller(site, ctx, hosts, deadline),
    limits: install.limits(),
    classes,
    deadline,
  });
}
