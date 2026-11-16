/**
 * The reads and the one write every default-Layout path shares.
 *
 * The route, the guards, the repair and the render helper all ask the same two
 * questions — what the settings Single names, and which of some Layouts are
 * published now — so each is answered once, here, and the paths cannot come to
 * disagree about what "published" or "the default" means.
 *
 * @module default-layout/store
 */
import type { Nextly } from "nextly";

import type { ActionBy } from "../component-actions-contract";
import {
  asOverwrite,
  documentVersionOf,
  withVersionFrom,
} from "../document-version";

import { DEFAULT_LAYOUT_WRITE_CONTEXT } from "./settings-single";

/**
 * The Direct API surface these paths use, PICKED from the real type rather than
 * restated, so a test double cannot agree with a wrong description of it.
 */
export type DefaultLayoutDirectApi = Pick<
  Nextly,
  | "find"
  | "findByID"
  | "create"
  | "delete"
  | "update"
  | "findSingle"
  | "updateSingle"
  | "jobs"
>;

/** The RESOLVED slugs: a host may rename the Layouts collection or the Single. */
export interface DefaultLayoutSlugs {
  readonly layouts: string;
  readonly settings: string;
}

/** What the settings Single names, by id. */
export interface LayoutSettings {
  readonly defaultLayout: string | null;
  readonly seededLayout: string | null;
  /**
   * Who made the current default, as {@link changedByOf} writes it:
   * `user:<id>` for a person, `api-key:<id>` for an API key. A bare id is a
   * person's, recorded before the kind was written. Null for a default the
   * plugin set itself (the seed, or the repair) or one recorded before this
   * existed.
   */
  readonly defaultLayoutChangedBy: string | null;
  /**
   * The settings document's version as read, which a write made from this
   * read sends back; absent when the document was never stored.
   */
  readonly rev: string | undefined;
}

/**
 * Who chose a default, as the settings record it: the API key itself for a
 * key, never its owner, so a key's choice is told apart from the person's.
 */
export function changedByOf(by: ActionBy): string {
  return by.kind === "api-key" && by.apiKeyId !== undefined
    ? `api-key:${by.apiKeyId}`
    : `user:${by.userId}`;
}

/**
 * A relationship value as an id. A read at depth 0 answers the id; a populated
 * read answers the row, so both are accepted rather than trusting one shape.
 */
export function relationId(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "object" && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id !== "") return id;
  }
  return null;
}

/**
 * The settings Single's two references, read as the system.
 *
 * Read WITHOUT creating the document (`createIfMissing: false`). A plain Single
 * read creates a missing document, which would make every reader here a
 * writer, a page render among them. A site whose settings were never stored
 * answers both references as `null`, which every caller already reads as "no
 * default". The one writer, `writeLayoutSettings`, still creates the document
 * when it is missing: a Single update does.
 */
export async function readLayoutSettings(
  nextly: Pick<DefaultLayoutDirectApi, "findSingle">,
  slugs: DefaultLayoutSlugs
): Promise<LayoutSettings> {
  const doc: Record<string, unknown> | null = await nextly.findSingle({
    slug: slugs.settings,
    depth: 0,
    overrideAccess: true,
    createIfMissing: false,
    // Both identity channels cleared, as every system read a published page
    // makes clears them: an omitted one is filled from the instance's own
    // defaults, so a reader booted with a user would hand that user to the
    // Single's read hooks, and a page render caches what this answers for
    // every visitor.
    user: undefined,
    req: undefined,
  });
  return {
    defaultLayout: relationId(doc?.defaultLayout),
    seededLayout: relationId(doc?.seededLayout),
    defaultLayoutChangedBy:
      typeof doc?.defaultLayoutChangedBy === "string" &&
      doc.defaultLayoutChangedBy !== ""
        ? doc.defaultLayoutChangedBy
        : null,
    rev: documentVersionOf(doc),
  };
}

/**
 * Write the settings Single, with the marker its guard admits.
 *
 * The only function that carries the marker, so the set of sanctioned writers
 * is the set of callers of this function. `from` is the read the write was
 * decided on: the write sends its version, so a change to the settings made
 * since refuses the write rather than being overwritten. Settings never
 * stored have no version, and nothing to overwrite, so the first write says
 * it sets them whatever is there. `"overwrite"` is a write that sets its
 * values whatever the settings hold, decided on no read of them.
 */
export async function writeLayoutSettings(
  nextly: Pick<DefaultLayoutDirectApi, "updateSingle">,
  slugs: DefaultLayoutSlugs,
  from: LayoutSettings | "overwrite",
  data: {
    defaultLayout?: string | null;
    seededLayout?: string | null;
    defaultLayoutChangedBy?: string | null;
  }
): Promise<void> {
  await nextly.updateSingle({
    slug: slugs.settings,
    data:
      from === "overwrite" || from.rev === undefined
        ? asOverwrite(data)
        : withVersionFrom(data, from.rev),
    overrideAccess: true,
    context: { ...DEFAULT_LAYOUT_WRITE_CONTEXT },
  });
}

/**
 * Which of `ids` name a Layout whose main row is published now.
 *
 * One query for all of them. The MAIN row is what counts: a published Layout
 * holding an unpublished edit keeps its main row published, and is still what
 * the site serves. A missing id is simply absent from the answer.
 */
export async function publishedLayoutIds(
  nextly: Pick<DefaultLayoutDirectApi, "find">,
  slugs: DefaultLayoutSlugs,
  ids: readonly string[]
): Promise<ReadonlySet<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const found = await nextly.find({
    collection: slugs.layouts,
    where: { id: { in: unique } },
    status: "published",
    limit: unique.length,
    depth: 0,
    // Only the id is read from these rows, so only the id is fetched.
    select: { id: true },
    overrideAccess: true,
  });
  const published = new Set<string>();
  for (const row of found.items) {
    const id = relationId(row);
    if (id !== null) published.add(id);
  }
  return published;
}

/**
 * Whether a Layout row exists at all, whatever its lifecycle state. The one
 * answer the repair and the make-default route both ask.
 */
export async function layoutExists(
  nextly: Pick<DefaultLayoutDirectApi, "find">,
  // Only the Layouts slug: a page's publish asks this without the Single.
  slugs: Pick<DefaultLayoutSlugs, "layouts">,
  id: string
): Promise<boolean> {
  const found = await nextly.find({
    collection: slugs.layouts,
    where: { id: { equals: id } },
    status: "all",
    limit: 1,
    depth: 0,
    // Existence is the whole answer; no column of the row is read.
    select: { id: true },
    overrideAccess: true,
  });
  return found.items.length > 0;
}

/**
 * Whether Layout `id` can be a default: it is published now. The one test of
 * a usable default, for the Single's own default and for a Layout about to
 * become it.
 */
export async function isUsableDefault(
  nextly: Pick<DefaultLayoutDirectApi, "find">,
  slugs: DefaultLayoutSlugs,
  id: string
): Promise<boolean> {
  return (await publishedLayoutIds(nextly, slugs, [id])).has(id);
}

/** Whether the Single's default names a Layout that is published now. */
export async function defaultIsUsable(
  nextly: Pick<DefaultLayoutDirectApi, "find" | "findSingle">,
  slugs: DefaultLayoutSlugs
): Promise<boolean> {
  const { defaultLayout } = await readLayoutSettings(nextly, slugs);
  if (defaultLayout === null) return false;
  return isUsableDefault(nextly, slugs, defaultLayout);
}
