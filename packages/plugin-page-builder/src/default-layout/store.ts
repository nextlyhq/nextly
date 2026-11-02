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

/** The settings Single's two references, read as the system. */
export async function readLayoutSettings(
  nextly: Pick<DefaultLayoutDirectApi, "findSingle">,
  slugs: DefaultLayoutSlugs
): Promise<LayoutSettings> {
  const doc = (await nextly.findSingle({
    slug: slugs.settings,
    depth: 0,
    overrideAccess: true,
  })) as Record<string, unknown> | null;
  return {
    defaultLayout: relationId(doc?.defaultLayout),
    seededLayout: relationId(doc?.seededLayout),
  };
}

/**
 * Write the settings Single, with the marker its guard admits.
 *
 * The only function that carries the marker, so the set of sanctioned writers
 * is the set of callers of this function.
 */
export async function writeLayoutSettings(
  nextly: Pick<DefaultLayoutDirectApi, "updateSingle">,
  slugs: DefaultLayoutSlugs,
  data: {
    defaultLayout?: string | null;
    seededLayout?: string | null;
    defaultLayoutChangedBy?: string | null;
  }
): Promise<void> {
  await nextly.updateSingle({
    slug: slugs.settings,
    data,
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
    overrideAccess: true,
  });
  const published = new Set<string>();
  for (const row of found.items) {
    const id = relationId(row);
    if (id !== null) published.add(id);
  }
  return published;
}

/** Whether the Single's default names a Layout that is published now. */
export async function defaultIsUsable(
  nextly: Pick<DefaultLayoutDirectApi, "find" | "findSingle">,
  slugs: DefaultLayoutSlugs
): Promise<boolean> {
  const { defaultLayout } = await readLayoutSettings(nextly, slugs);
  if (defaultLayout === null) return false;
  return (await publishedLayoutIds(nextly, slugs, [defaultLayout])).has(
    defaultLayout
  );
}
