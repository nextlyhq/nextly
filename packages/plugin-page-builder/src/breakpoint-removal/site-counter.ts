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
import { entryOf, readSavedAsCaller } from "../entry-reads";
import type { HostAddress } from "../host-rewrite/contract";
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
 * What the caller knows an entry by, or `null` when they may not read it: its
 * saved row read as them, drafts included, titled by the rule every entries
 * list names a row by.
 */
async function entryNameAsCaller(
  site: Pick<DocumentSite, "resolveCollection">,
  ctx: Pick<PluginRouteContext, "caller">,
  host: HostAddress
): Promise<string | null> {
  const record = await site.resolveCollection(host.slug);
  const titleField =
    typeof record === "object" && record !== null
      ? titleFieldIn(record)?.name
      : undefined;
  const row = await readSavedAsCaller(ctx, {
    collection: host.slug,
    id: host.id ?? "",
    select: {
      id: true,
      ...(titleField === undefined ? {} : { [titleField]: true }),
    },
  });
  return row === null ? null : (entryOf(row, titleField)?.title ?? null);
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
    nameFor: async host =>
      host.kind === "single"
        ? singleNameAsCaller(await install.naming(), ctx, host)
        : entryNameAsCaller(site, ctx, host),
    limits: install.limits(),
    classes,
    deadline,
  });
}
