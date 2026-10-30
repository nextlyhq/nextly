/**
 * Every collection's, Single's and field group's fields as the registry records them before a
 * code-first run changes them, so the run can tell a field it newly translates from one translated
 * before it.
 *
 * The companion sync takes a column already on a translations table as a translated field's own.
 * For a field translated before the run, that column is the field's; for one the run newly
 * translates, it may be another field's leftover, and is judged first
 * (`companionColumnsThatCannotHold`). The registry is the only record of "before", and each run
 * rewrites it before its companion sync, so the run reads it first and hands it down.
 *
 * @module domains/i18n/migration/recorded-before
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../shared/types";
import { localizableConfigEntities } from "../runtime/localizable-config-entities";

import type { CompanionFieldLike } from "./reconcile-companion";
import type { I18nTransitionKind } from "./transition-state";

/** One entity as the registry recorded it. */
export interface RecordedEntity {
  localized: boolean;
  fields: readonly CompanionFieldLike[];
}

/** Every recorded entity, by kind and slug (`recordedBeforeOf`). */
export type RecordedEntities = ReadonlyMap<string, RecordedEntity>;

const keyOf = (kind: I18nTransitionKind, slug: string) => `${kind}:${slug}`;

/** The registry's records consult nothing else, so their own logging has nowhere to go. */
const QUIET: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Reads every collection, Single and field group the registry records, before a run changes them:
 * only their slug, whether they are translated, and their fields.
 *
 * Undefined, reading nothing, when the config translates no entity: no translations column is
 * judged then. Undefined too when the registry cannot be read, as before its tables exist; then
 * nothing is judged, as before this was asked, rather than every translated field being taken as
 * new and an install's long-standing columns refused, and `onUnreadable` is told why, so the run
 * can say its translations columns went unjudged.
 */
export async function readRecordedEntities(
  adapter: DrizzleAdapter,
  config: Parameters<typeof localizableConfigEntities>[0],
  onUnreadable?: (error: unknown) => void
): Promise<RecordedEntities | undefined> {
  const translates = localizableConfigEntities(config).some(([, entities]) =>
    entities.some(entity => entity.localized === true)
  );
  if (!translates) return undefined;
  try {
    const [
      { CollectionRegistryService },
      { SingleRegistryService },
      { FieldGroupRegistryService },
    ] = await Promise.all([
      import("../../collections/services/collection-registry-service"),
      import("../../singles/services/single-registry-service"),
      import("../../field-groups/services/field-group-registry-service"),
    ]);
    const [collections, singles, fieldGroups] = await Promise.all([
      new CollectionRegistryService(adapter, QUIET).getAllTranslationShapes(),
      new SingleRegistryService(adapter, QUIET).getAllTranslationShapes(),
      new FieldGroupRegistryService(adapter, QUIET).getAllTranslationShapes(),
    ]);
    const recorded = new Map<string, RecordedEntity>();
    for (const [kind, records] of [
      ["collection", collections],
      ["single", singles],
      ["fieldGroup", fieldGroups],
    ] as const) {
      for (const record of records) {
        recorded.set(keyOf(kind, record.slug), {
          localized: (record as { localized?: boolean }).localized === true,
          fields: (record.fields ?? []) as unknown as CompanionFieldLike[],
        });
      }
    }
    return recorded;
  } catch (error) {
    onUnreadable?.(error);
    return undefined;
  }
}

/**
 * One entity as it was recorded before the run: `null` for one the registry did not hold, every
 * translated field of which is new; undefined when nothing was read, so nothing is judged.
 */
export function recordedBeforeOf(
  recorded: RecordedEntities | undefined,
  kind: I18nTransitionKind,
  slug: string
): RecordedEntity | null | undefined {
  return recorded === undefined
    ? undefined
    : (recorded.get(keyOf(kind, slug)) ?? null);
}
