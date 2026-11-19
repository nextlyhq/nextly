/**
 * The person reading the problem list, as the list asks about them: which
 * of its pages they may read, asked of the collections themselves as that
 * person, so a read rule that admits only some entries (their own, say)
 * decides, as it does for every other read. The list's routes and the
 * dashboard's SEO card both read the list through it, each with the reads
 * bound to its own person, and Pages lists only the entries it admits.
 *
 * @module problems/reader
 */
import {
  readableContent,
  type PluginContext,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { pageRefKey, type ProblemChecks, type Reader } from "./check";
import { pageTypeOf, singleKey } from "./page-types";

/** The person core is asked about, by id and, where known, their roles. */
type ReadableContentCaller = Parameters<typeof readableContent>[0];

/** The reads a reader is judged by, each made as the person. */
export interface ReadsAs {
  /** Which of `ids`, entries of the collection `type`, the person may read. */
  readable(type: string, ids: readonly string[]): Promise<string[]>;
  /** How many entries of the collection `type` the person may read. */
  count(type: string): Promise<number>;
}

/** The pages of `refs` grouped by type, each id once. */
function idsByType(
  refs: Parameters<Reader["pages"]>[0]
): Map<string, string[]> {
  const byType = new Map<string, Set<string>>();
  for (const { type, id } of refs) {
    const ids = byType.get(type) ?? new Set<string>();
    ids.add(id);
    byType.set(type, ids);
  }
  return new Map([...byType].map(([type, ids]) => [type, [...ids]]));
}

/**
 * The reader `reads` reads as, who may read the types `types` names, by the
 * key their pages are kept under. A type they may not read at all is not
 * asked about, and a Single's page is theirs where they may read the
 * Single. `seesRedirects` is whether they hold site-wide SEO.
 */
export function readerAs(
  reads: ReadsAs,
  types: ReadonlySet<string>,
  seesRedirects: boolean
): Reader {
  const pages: Reader["pages"] = async refs => {
    const allowed = new Set<string>();
    for (const [type, ids] of idsByType(refs)) {
      if (!types.has(type)) continue;
      // A Single's one page is read by whoever may read the Single.
      const readable =
        pageTypeOf(type).kind === "single"
          ? ids
          : await reads.readable(type, ids);
      for (const id of readable) allowed.add(pageRefKey({ type, id }));
    }
    return allowed;
  };
  return {
    pages,
    readsType: type => types.has(type),
    count: type => reads.count(type),
    seesRedirects,
  };
}

/** `ids` in pieces of at most `size`, each read by `read`, the answers joined. */
export async function inChunks(
  ids: readonly string[],
  size: number,
  read: (chunk: string[]) => Promise<string[]>
): Promise<string[]> {
  const found: string[] = [];
  for (let at = 0; at < ids.length; at += size) {
    found.push(...(await read(ids.slice(at, at + size))));
  }
  return found;
}

/** How many ids one read of a type asks about. */
const ID_CHUNK = 100;

/** The collections' reads, and the access each is made with. */
type Collections = PluginContext["services"]["collections"];
type ReadAccess = NonNullable<Parameters<Collections["listEntries"]>[2]>;

/**
 * The reads a person is judged by, each made with `asPerson` through the
 * collections' own reads, so their row rules decide as they do anywhere.
 */
export function readsAs(
  collections: Collections,
  asPerson: ReadAccess
): ReadsAs {
  return {
    readable: (type, ids) =>
      inChunks(ids, ID_CHUNK, async chunk => {
        const { data } = await collections.listEntries(
          type,
          {
            where: { id: { in: chunk } },
            select: { id: true },
            depth: 0,
            pagination: { limit: chunk.length, page: 1 },
          },
          asPerson
        );
        return (data as { id?: unknown }[]).map(entry => String(entry.id));
      }),
    // Counted as the person, so a rule admitting only some entries decides.
    count: type => collections.count(type, {}, asPerson),
  };
}

/**
 * The reads a plugin route's caller is judged by, each made as them: in
 * `locale` where one is named, as a rule may read a translated field.
 */
export function callerReads(ctx: PluginRouteContext, locale?: string): ReadsAs {
  return readsAs(ctx.services.collections, {
    as: "user" as const,
    user: ctx.user ?? undefined,
    ...(ctx.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: ctx.authenticatedScope }),
    ...(locale === undefined ? {} : { locale }),
  });
}

/**
 * The types of `checks` that `caller` may read, by the key their pages are
 * kept under, as core decides it for them (`readableContent`): for a reader
 * that is handed a person rather than a route's caller. An API key's scope
 * goes with it, so its grants decide rather than its owner's.
 */
export async function readableTypesOf(
  caller: ReadableContentCaller,
  checks: Pick<ProblemChecks, "targets" | "singles">
): Promise<Set<string>> {
  const { user, authenticatedScope } = caller;
  const { entities } = await readableContent({
    user: {
      id: user.id,
      ...(user.roles === undefined ? {} : { roles: user.roles }),
    },
    ...(authenticatedScope === undefined ? {} : { authenticatedScope }),
  });
  const collections = new Set(checks.targets);
  const singles = new Set(checks.singles);
  const readable = new Set<string>();
  for (const { slug, kind } of entities) {
    if (kind === "collection" && collections.has(slug)) readable.add(slug);
    if (kind === "single" && singles.has(slug)) readable.add(singleKey(slug));
  }
  return readable;
}
