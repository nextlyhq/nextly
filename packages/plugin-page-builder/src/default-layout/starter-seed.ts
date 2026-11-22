/**
 * The starter header and footer a fresh site's first seed creates, and their
 * removal when the seed fails part-way.
 *
 * Created published, each marked for its area ("Use as: Header" / "Footer"),
 * under the first titles and slugs no component holds, by the same first-free
 * rule the set's own name takes. What the seed records about them, and when it
 * creates them at all, is `ensure-default`'s and `starter-record`'s.
 *
 * @module default-layout/starter-seed
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { starterSlug, starterTitle, type StarterArea } from "./seed-names";
import { starterDocument } from "./starter-documents";
import {
  starterFingerprint,
  type StarterComponents,
  type StarterRecordStore,
} from "./starter-record";
import { relationId, type DefaultLayoutDirectApi } from "./store";
import { takenNames } from "./taken-names";

/**
 * How many slugs a starter component tries when the database refuses one the
 * scan saw as free (MySQL compares slugs without case or accents). Bounded,
 * so the run fails rather than looping; the sweep tries again later.
 */
const SLUG_ATTEMPTS = 5;

/** What the seed needs to make a starter, from the installed plugin. */
export interface StarterParts {
  /** The RESOLVED collection components are stored in. */
  readonly components: string;
  /** Where the starter is recorded, and claimed between racing runs. */
  readonly record: StarterRecordStore;
  /** Delete a component this run created and nothing places, as the system. */
  readonly removeComponent: (
    nextly: Pick<DefaultLayoutDirectApi, "delete" | "find">,
    id: string
  ) => Promise<void>;
}

/** What creating the starter needs. */
export interface StarterSeedDeps {
  readonly nextly: DefaultLayoutDirectApi;
  readonly starter: StarterParts;
  /** The RESOLVED pages collection the starter's links list. */
  readonly pagesSlug: string;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Create the starter header and then the footer, answering what to record.
 * A failure after the header was created removes it before rethrowing, so
 * a failed call leaves no component behind.
 */
export async function createStarterComponents(
  deps: StarterSeedDeps
): Promise<StarterComponents> {
  const taken = await takenNames(deps.nextly, deps.starter.components);
  const header = await createStarterComponent(deps, "header", taken);
  try {
    const footer = await createStarterComponent(deps, "footer", taken);
    return { header, footer };
  } catch (error) {
    await removeStarterComponents(deps, [header.id]);
    throw error;
  }
}

/**
 * Remove components a seed created, best effort: each failure is logged,
 * never thrown, so the caller rethrows the failure that sent it here.
 */
export async function removeStarterComponents(
  deps: Pick<StarterSeedDeps, "nextly" | "starter" | "warn">,
  ids: readonly string[]
): Promise<void> {
  for (const id of ids) {
    await deps.starter
      .removeComponent(deps.nextly, id)
      .catch((error: unknown) => {
        deps.warn(
          "[page-builder] a starter component from a seed that did not finish could not be removed; delete it by hand",
          {
            component: id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      });
  }
}

/** One starter component, created under the first free title and slug. */
async function createStarterComponent(
  deps: StarterSeedDeps,
  area: StarterArea,
  taken: { titles: Set<string>; slugs: Set<string> }
): Promise<{ id: string; fingerprint: string }> {
  const content = starterDocument(area, deps.pagesSlug);
  const title = starterTitle(area, taken.titles);
  for (let attempt = 1; ; attempt += 1) {
    const slug = starterSlug(area, taken.slugs);
    try {
      const created = await deps.nextly.create({
        collection: deps.starter.components,
        data: { title, slug, area, content, status: "published" },
        overrideAccess: true,
      });
      const id = relationId(created.item);
      if (id === null) {
        throw new NextlyError({
          code: "INTERNAL_ERROR",
          publicMessage:
            "The starter header or footer was created but could not be identified.",
          logMessage: "create returned no usable id for a starter component",
          logContext: { reason: "starter-component-no-id", area },
        });
      }
      taken.titles.add(title);
      taken.slugs.add(slug);
      // What was stored, which is what a later published read answers.
      const stored = (created.item as { content?: unknown }).content;
      return {
        id,
        fingerprint: starterFingerprint(
          typeof stored === "object" && stored !== null ? stored : content
        ),
      };
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      if (attempt >= SLUG_ATTEMPTS) throw error;
      taken.slugs.add(slug);
    }
  }
}
