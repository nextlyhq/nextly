/**
 * The collections a reader last created entries of, from the dashboard's New
 * button and the command palette: up to three, the most recent first.
 *
 * Kept in the dashboard's preferences under `new-type`, a short JSON list of
 * collection slugs. What is stored is a hint, never a grant: every read keeps
 * only the slugs of collections that still exist and that this reader may
 * still create in, so the button never offers a type the reader cannot use.
 * Recording one asks the same question first, so nothing else is stored, and
 * runs one at a time for each reader, so two recorded at once are both kept.
 *
 * @module services/dashboard/new-types-service
 * @experimental Until the dashboard's New button is built on it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di/container";
import { DashboardPreferences } from "../../domains/dashboard/dashboard-preferences";
import { NextlyError } from "../../errors/nextly-error";

/** How many types a reader's list keeps: the New menu shows them first. */
export const NEW_TYPES_KEPT = 3;

const KEY = "new-type";

/**
 * The slugs a stored value lists, in order, each once; none for a value that is
 * not such a list. Not cut to {@link NEW_TYPES_KEPT}: a read keeps three of
 * those the reader may still use, not three of those stored.
 */
export function storedNewTypes(value: string | undefined): string[] {
  if (value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const slugs = parsed.filter(
    (slug): slug is string => typeof slug === "string" && slug.length > 0
  );
  return [...new Set(slugs)];
}

/** The list with `slug` first, each slug once, at most {@link NEW_TYPES_KEPT}. */
export function withNewType(stored: readonly string[], slug: string): string[] {
  return [slug, ...stored.filter(each => each !== slug)].slice(
    0,
    NEW_TYPES_KEPT
  );
}

/** Whether this reader may create entries of the collection `slug` names. */
export type MayCreate = (slug: string) => Promise<boolean>;

interface NewTypesDeps {
  readonly preferences: Pick<DashboardPreferences, "get" | "update">;
  /** Whether a collection of this slug exists now. */
  readonly collectionExists: (slug: string) => Promise<boolean>;
}

export class NewTypesService {
  constructor(private readonly deps: NewTypesDeps) {}

  /**
   * The reader's recent types they may still create in, most recent first:
   * each stored slug kept only while its collection exists and `mayCreate`
   * says yes.
   */
  async recent(userId: string, mayCreate: MayCreate): Promise<string[]> {
    const { usable } = await this.judged(userId, mayCreate);
    return usable.slice(0, NEW_TYPES_KEPT);
  }

  /** The reader's stored slugs, split by whether they may still use each. */
  private async judged(
    userId: string,
    mayCreate: MayCreate
  ): Promise<{ usable: string[]; unusable: string[] }> {
    const stored = storedNewTypes(await this.deps.preferences.get(userId, KEY));
    const verdicts = await Promise.all(
      stored.map(
        async slug =>
          (await this.deps.collectionExists(slug)) && (await mayCreate(slug))
      )
    );
    return {
      usable: stored.filter((_, index) => verdicts[index]),
      unusable: stored.filter((_, index) => !verdicts[index]),
    };
  }

  /**
   * Records `slug` first in the reader's list, and answers the list as a read
   * would. A collection that does not exist, or that this reader may not
   * create in, is refused before anything is written.
   *
   * The types stored now are judged first, outside the write, since asking
   * whether a reader may create is not the write's to do. The write reads the
   * list again under the reader's lock ({@link DashboardPreferences.update})
   * and drops only the types judged unusable: one stored since, by another of
   * the reader's records running at the same time, was judged by that record
   * and is kept, so neither record loses the other's type.
   */
  async record(
    userId: string,
    slug: string,
    mayCreate: MayCreate
  ): Promise<string[]> {
    if (!(await this.deps.collectionExists(slug)) || !(await mayCreate(slug))) {
      throw NextlyError.forbidden({
        logContext: { reason: "new-type-not-creatable", slug },
      });
    }
    const unusable = new Set((await this.judged(userId, mayCreate)).unusable);
    const written = await this.deps.preferences.update(userId, KEY, stored =>
      JSON.stringify(
        withNewType(
          storedNewTypes(stored).filter(each => !unusable.has(each)),
          slug
        )
      )
    );
    return storedNewTypes(written);
  }
}

/** The service over the running instance's database and collection registry. */
export function newTypesService(): NewTypesService {
  const collections = container.get<{
    getCollectionBySlug: (slug: string) => Promise<unknown>;
  }>("collectionRegistryService");
  return new NewTypesService({
    preferences: new DashboardPreferences(
      container.get<DrizzleAdapter>("adapter")
    ),
    collectionExists: async slug =>
      (await collections.getCollectionBySlug(slug)) != null,
  });
}
