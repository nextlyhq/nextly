/**
 * Every write to an entry of a collection or Single removed from code is
 * refused, wherever it comes from.
 *
 * Such an entity's registry row says the app's code defines it, and the
 * running configuration no longer declares it (`isRemovedFromCode`). Its
 * tables are kept until a migration retires it, and its entries stay readable,
 * but nothing the configuration describes writes to them any more: an edit
 * made there would land in storage the next migration drops, or that the app
 * no longer reads. So every write is refused, through every entry point, until
 * the entity is retired or declared again.
 *
 * Two halves:
 *
 * - The slugs the running configuration declares, published by the boot and
 *   by each configuration reload that lands, and cleared when the services are
 *   released. Unpublished, nothing is known about the configuration, so
 *   nothing is refused: a process that never booted from one cannot tell a
 *   removed entity from a Builder one.
 * - {@link refuseWriteIfRemovedFromCode}, which each write path calls before
 *   its work, so a refused write changes nothing and runs no hook.
 *
 * @module domains/dynamic-collections/services/removed-from-code-writes
 */

import { getService } from "../../../di/service-access";
import { NextlyError } from "../../../errors/nextly-error";

import { declaredSlugsOf, isRemovedFromCode } from "./removed-from-code";

/** Which registry an entity's row lives in. */
export type RemovableEntityKind = "collection" | "single";

/** The slugs a configuration declares, per kind. */
export interface DeclaredEntities {
  readonly collections: ReadonlySet<string>;
  readonly singles: ReadonlySet<string>;
}

/**
 * Kept on `globalThis` so every copy of this module in one process reads the
 * one set the boot published, as the other process-wide published state does.
 */
const globalForDeclared = globalThis as unknown as {
  __nextly_declaredEntities?: DeclaredEntities;
};

/**
 * Publish the entities `config` declares, or clear them with `undefined`, and
 * answer the set it replaces so a reload that does not land can put it back.
 */
export function publishDeclaredEntities(
  config:
    | {
        collections?: ReadonlyArray<{ slug?: string | null }>;
        singles?: ReadonlyArray<{ slug?: string | null }>;
      }
    | undefined
): DeclaredEntities | undefined {
  const previous = globalForDeclared.__nextly_declaredEntities;
  globalForDeclared.__nextly_declaredEntities =
    config === undefined
      ? undefined
      : {
          collections: declaredSlugsOf(config.collections),
          singles: declaredSlugsOf(config.singles),
        };
  return previous;
}

/** Put back a set {@link publishDeclaredEntities} answered. */
export function restoreDeclaredEntities(
  declared: DeclaredEntities | undefined
): void {
  globalForDeclared.__nextly_declaredEntities = declared;
}

/** The registry row's identity, or null when the registry holds none. */
type RegistryLookup = (
  kind: RemovableEntityKind,
  slug: string,
  executor?: unknown
) => Promise<{ slug?: string | null; source?: string | null } | null>;

/**
 * Read from the registry the services registered. The executor, when given,
 * is the caller's transaction, so a write inside one does not take a second
 * pooled connection for this read.
 */
const readRegistryRow: RegistryLookup = async (kind, slug, executor) =>
  kind === "single"
    ? getService("singleRegistryService").getSingleBySlug(slug, executor)
    : getService("collectionRegistryService").getCollectionBySlug(
        slug,
        executor
      );

/**
 * Refuse the write about to be made to `slug`'s entries when that entity is
 * removed from code.
 *
 * Called first, before any hook or read of the entry, since it is a
 * precondition: a refusal after the work would leave the change made. A slug
 * the configuration declares is answered from the published set alone, so a
 * write to a declared entity reads nothing more. Only a slug it does not
 * declare (a Builder entity, or one removed) costs a registry read.
 *
 * A slug the registry does not hold is left to the write itself, which
 * answers it as it always has.
 */
export async function refuseWriteIfRemovedFromCode(
  kind: RemovableEntityKind,
  slug: string,
  options: { executor?: unknown; lookup?: RegistryLookup } = {}
): Promise<void> {
  const declared = globalForDeclared.__nextly_declaredEntities;
  if (declared === undefined) return;
  const slugs = kind === "single" ? declared.singles : declared.collections;
  if (slugs.has(slug)) return;
  const row = await (options.lookup ?? readRegistryRow)(
    kind,
    slug,
    options.executor
  );
  if (row && isRemovedFromCode(row, slugs)) {
    throw NextlyError.removedFromCode({ kind, slug });
  }
}

/**
 * {@link refuseWriteIfRemovedFromCode} for a write to a document's history: a
 * version's label, a "seen" marker, an autosave, a pin. History is kept for
 * other kinds of document too, which this rule says nothing about, so only a
 * collection's or a Single's is judged.
 */
export async function refuseHistoryWriteIfRemovedFromCode(
  ref: { scopeKind: string; scopeSlug: string },
  options: { executor?: unknown } = {}
): Promise<void> {
  if (ref.scopeKind !== "collection" && ref.scopeKind !== "single") return;
  await refuseWriteIfRemovedFromCode(ref.scopeKind, ref.scopeSlug, options);
}
