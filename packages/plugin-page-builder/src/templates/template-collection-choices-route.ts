/**
 * `GET /templates/collection-choices`: the collections a template may draw,
 * as the template form offers them, by slug and name.
 *
 * Which collections may have a template is the guard's question alone
 * (`templateCollectionProblem`), asked here of each collection with the
 * guard's own record read, so the form offers exactly what a save would let
 * through: never a collection whose `slug` field is not text, the page
 * builder's own collections (its Pages among them), or one kept out of the
 * admin. Inferring it from the fields the public may read would offer a
 * collection whose `slug` is hidden from visitors, and the save would refuse
 * it.
 *
 * Who asks first: only a caller who may create or change templates, the two
 * writes that name a collection, is answered, and that is asked before
 * anything is read. Then only a collection the caller may read
 * (`caller.can("read", slug)`) is judged and named, as the loop collections
 * route lists them, so nothing of a collection they cannot read travels.
 *
 * It decides nothing: the guard judges the write that names a collection,
 * whichever control wrote it.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/template-collection-choices-route
 */
import {
  NextlyError,
  respondList,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { labelOf, pluralLabelOf } from "../collection-labels";
import { onePage } from "../loop-collections-route";
import {
  registryRecords,
  slugOf,
  type PageCollectionsContext,
} from "../pages-search-route";

import {
  TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH,
  type TemplateCollectionChoice,
} from "./template-actions-contract";
import {
  templateCollectionProblem,
  type TemplateGuardSetup,
} from "./template-guard";

/**
 * What the choices are read with, injected so the decisions in
 * {@link readTemplateCollectionChoices} are tested without a server.
 */
export interface TemplateCollectionChoicesReads {
  /** Whether the caller may create or change templates at all. */
  mayWriteTemplates(): Promise<boolean>;
  /** Every collection record the registry holds. */
  collections(): Promise<readonly unknown[]>;
  /** Whether the caller may read this collection. */
  mayRead(slug: string): Promise<boolean>;
  /** The guard's own setup: its record read and the plugin's collections. */
  readonly guard: Pick<TemplateGuardSetup, "readCollection" | "ownCollections">;
}

/** Each listed collection once, by slug, with its record for its name. */
function listedOnce(
  records: readonly unknown[]
): Array<{ slug: string; record: Record<string, unknown> }> {
  const seen = new Set<string>();
  const listed: Array<{ slug: string; record: Record<string, unknown> }> = [];
  for (const value of records) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    const slug = slugOf(record);
    if (slug === undefined || seen.has(slug)) continue;
    seen.add(slug);
    listed.push({ slug, record });
  }
  return listed;
}

/**
 * Answer one read: the collections the caller may read that the guard lets a
 * template draw, by name and then slug, so two of one name keep one order.
 * Refuses a caller who may write no template before anything is read.
 */
export async function readTemplateCollectionChoices(
  reads: TemplateCollectionChoicesReads
): Promise<TemplateCollectionChoice[]> {
  if (!(await reads.mayWriteTemplates())) {
    throw NextlyError.forbidden({
      logContext: { route: TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH },
    });
  }
  const listed = listedOnce(await reads.collections());
  // Asked together: each is the caller's own permission read, resolved once
  // per request, so one collection's answer never waits on another's.
  const readable = await Promise.all(
    listed.map(({ slug }) => reads.mayRead(slug))
  );
  const own = reads.guard.ownCollections();
  const judged = await Promise.all(
    listed
      .filter((_, index) => readable[index] === true)
      .map(async ({ slug, record }) => ({
        slug,
        label: pluralLabelOf(record).pluralLabel ?? labelOf(record, slug),
        problem: await templateCollectionProblem(
          slug,
          reads.guard.readCollection,
          own
        ),
      }))
  );
  return judged
    .filter(choice => choice.problem === null)
    .map(({ slug, label }) => ({ slug, label }))
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.slug.localeCompare(b.slug)
    );
}

/** The writes that name a template's collection, either of which the form makes. */
const TEMPLATE_WRITES = ["create", "update"] as const;

/** The route context this reads: the registry, the plugin's slugs, and who asks. */
interface ChoicesRouteContext extends PageCollectionsContext {
  readonly user: PluginRouteContext["user"];
  readonly caller: PluginRouteContext["caller"];
}

/** The reads the route binds: the registry listing and the caller's rights. */
function directChoicesReads(
  ctx: ChoicesRouteContext,
  guard: TemplateGuardSetup
): TemplateCollectionChoicesReads {
  const { user, caller } = ctx;
  return {
    // Asked of any entry, as the template actions ask theirs: a rule that
    // limits which templates the caller may write is the write's to apply.
    // No person, no right.
    mayWriteTemplates: async () => {
      if (user === null || caller === null) return false;
      for (const action of TEMPLATE_WRITES) {
        if (
          await caller.can(action, guard.templatesCollection, {
            anyEntry: true,
          })
        ) {
          return true;
        }
      }
      return false;
    },
    collections: () => registryRecords(ctx),
    mayRead: slug =>
      caller === null ? Promise.resolve(false) : caller.can("read", slug),
    guard,
  };
}

/**
 * The route declaration. Authenticated, with no permission of its own: the
 * template rights are asked above before anything is read, and each
 * collection's read right one at a time. Never stored, since a collection is
 * added, renamed or removed at any time.
 */
export function templateCollectionChoicesRoute(setup: {
  readonly guard: () => TemplateGuardSetup;
}): {
  method: "GET";
  checksAccess: true;
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    noStore: true,
    handler: async (_req, ctx) => {
      const items = await readTemplateCollectionChoices(
        directChoicesReads(ctx, setup.guard())
      );
      return respondList(items, onePage(items.length));
    },
  };
}
