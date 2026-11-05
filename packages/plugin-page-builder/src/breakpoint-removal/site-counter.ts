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

/** The reads naming a document make, as the person asking. */
export interface NamingDirectApi {
  findByID(args: {
    collection: string;
    id: string;
    depth: number;
    overrideAccess: false;
  }): Promise<unknown>;
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

/** What an author knows an entry by: its title, its name, else its id. */
function titleOf(row: unknown, fallback: string): string {
  if (typeof row !== "object" || row === null) return fallback;
  const { title, name } = row as { title?: unknown; name?: unknown };
  if (typeof title === "string" && title !== "") return title;
  if (typeof name === "string" && name !== "") return name;
  return fallback;
}

/**
 * The name for a document the caller may read, or `null` for one they may
 * not: read with the caller's own identity, so the access gate that answers
 * their every read answers this one.
 */
async function nameAsCaller(
  nextly: NamingDirectApi,
  asUser: Awaited<ReturnType<typeof readingAsUser>>,
  host: HostAddress
): Promise<string | null> {
  try {
    if (host.kind === "single") {
      await nextly.findSingle({
        slug: host.slug,
        createIfMissing: false,
        depth: 0,
        ...asUser,
      });
      return host.slug;
    }
    const id = host.id ?? "";
    return titleOf(
      await nextly.findByID({ collection: host.slug, id, depth: 0, ...asUser }),
      id
    );
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
  classes: readonly NamedClass[]
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
  let asUser: Awaited<ReturnType<typeof readingAsUser>> | undefined;
  return countRemoval(removed, {
    documents: () => documents(null),
    read: siteHostReader(site),
    placeOf: host => placeOf(slugs, host),
    nameFor: async host => {
      asUser ??= await readingAsUser(ctx);
      return nameAsCaller(await install.naming(), asUser, host);
    },
    limits: install.limits(),
    classes,
    deadline: new Date(Date.now() + WALK_MS),
  });
}
