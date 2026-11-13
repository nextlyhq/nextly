/**
 * The reads a component a plugin adds to an admin place makes as it opens
 * (`startupReads` on a place contribution), as path templates over the
 * place's ids: the ids each place may name, filling them in, and the boot
 * check of a declared read.
 *
 * A plugin page has an exact address, so the prebuilt admin page carries its
 * reads; a place's addresses are patterns (`/admin/collections/<slug>/<id>`),
 * so its reads are filled in by the page that has the ids, as it first
 * renders. One filling for the boot check and for the admin, so a path the
 * boot accepted is the path the admin asks for.
 *
 * Imports nothing but types and the import-free startup reads, as the admin's
 * browser code reaches it through `nextly/config`.
 *
 * @module plugins/place-startup-reads
 */
import type { PluginPageStartupRead } from "./admin-contributions";
import type { AdminPlaces, CoreAdminPlaceId } from "./admin-places";
import { carriedStartupRead, MAX_PAGE_STARTUP_READS } from "./startup-reads";

/** The ids a place's reads may name: its context's, but the reader's own. */
type PlaceIds<P extends CoreAdminPlaceId> = Exclude<
  NamedKeys<AdminPlaces[P]["context"]>,
  "userId"
>;

/**
 * The keys a context names, without an index signature's `string`: the
 * login page's context is `Record<string, never>`, which names none.
 */
type NamedKeys<T> = keyof {
  [K in keyof T as string extends K ? never : K]: T[K];
};

/**
 * @experimental The ids each core place's reads may name, in braces: the keys
 * of its `AdminPlaces` context other than `userId`. Checked against that type
 * both ways below, so a place or an id added there is named here too.
 */
export const PLACE_STARTUP_IDS = Object.freeze({
  dashboard: [],
  "collection.list": ["collection"],
  "collection.edit": ["collection", "entryId"],
  "single.edit": ["single"],
  "entry.form": ["kind", "slug", "entryId"],
  settings: [],
  "user.detail": ["shownUserId"],
  account: [],
  login: [],
} as const satisfies { [P in CoreAdminPlaceId]: readonly PlaceIds<P>[] });

/**
 * The ids of a place's context the list above leaves out: `never` while it
 * names them all, which its test holds it to.
 */
export type UnnamedPlaceStartupIds = {
  [P in CoreAdminPlaceId]: Exclude<
    PlaceIds<P>,
    (typeof PLACE_STARTUP_IDS)[P][number]
  >;
}[CoreAdminPlaceId];

/** One id named in a read's path: `{collection}`. */
const NAMED_ID = /\{([A-Za-z]+)\}/g;

/** The ids a read's path names, in order. */
export function namedPlaceIds(path: string): string[] {
  return [...path.matchAll(NAMED_ID)].map(match => match[1]);
}

/**
 * `path` with each id it names filled in from `ids`, URI-component encoded,
 * or `null` where it names one the page does not have (absent, `null` or
 * empty: a new entry's `entryId`).
 */
export function fillPlaceStartupPath(
  path: string,
  ids: Readonly<Record<string, string | null | undefined>>
): string | null {
  let missing = false;
  const filled = path.replace(NAMED_ID, (_whole, name: string) => {
    const value = Object.hasOwn(ids, name) ? ids[name] : undefined;
    if (typeof value !== "string" || value === "") {
      missing = true;
      return "";
    }
    return encodeURIComponent(value);
  });
  return missing ? null : filled;
}

/** The ids `place` lets a read name: none for a plugin's own place. */
function idsOf(place: string): readonly string[] {
  return Object.hasOwn(PLACE_STARTUP_IDS, place)
    ? PLACE_STARTUP_IDS[place as CoreAdminPlaceId]
    : [];
}

/**
 * Why a contribution's declared `startupReads` cannot be started at `place`,
 * or `undefined` when every one can. Read as `unknown`, as boot reads a
 * JavaScript plugin's declaration.
 */
export function placeStartupReadsProblem(
  pluginName: string,
  place: string,
  reads: unknown
): string | undefined {
  if (reads === undefined) return undefined;
  if (!Array.isArray(reads)) return "its `startupReads` is not a list";
  if (reads.length > MAX_PAGE_STARTUP_READS) {
    return `it declares ${reads.length} startup reads; a contribution may declare at most ${MAX_PAGE_STARTUP_READS}`;
  }
  const allowed = idsOf(place);
  for (const read of reads as unknown[]) {
    if (
      typeof read !== "object" ||
      read === null ||
      typeof (read as { path?: unknown }).path !== "string"
    ) {
      return "it declares a startup read with no path";
    }
    const declared = read as PluginPageStartupRead;
    const stray = namedPlaceIds(declared.path).find(
      name => !allowed.includes(name)
    );
    if (stray !== undefined) {
      return (
        `its startup read "${declared.path}" names {${stray}}, which ` +
        (allowed.length === 0
          ? `the place "${place}" does not give`
          : `is not one of the place's ids (${allowed.map(id => `{${id}}`).join(", ")})`)
      );
    }
    // Filled as the page fills it, each id with a sample value, so the path
    // checked is the shape of the path asked for.
    const sample = fillPlaceStartupPath(
      declared.path,
      Object.fromEntries(allowed.map(id => [id, "sample-id"]))
    );
    if (
      sample === null ||
      carriedStartupRead(pluginName, { ...declared, path: sample }) === null
    ) {
      return (
        `its startup read "${declared.path}" is not a path the admin can ` +
        `ask for: name a route path starting with "/", of plain segments, ` +
        `with no ".." and at most 512 characters`
      );
    }
  }
  return undefined;
}
