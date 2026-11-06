/**
 * The entities a configuration declares that can be translated, by kind, each with how its
 * physical table is named. `db:sync` provisions their companions from this list and the boot
 * checks their indexes against it, so both read the same entities at the same tables.
 *
 * @module domains/i18n/runtime/localizable-config-entities
 */
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import type { I18nTransitionKind } from "../migration/transition-state";

/** A configured collection, Single or field group, as far as its translation goes. */
export interface LocalizableEntity {
  slug?: string;
  dbName?: string;
  localized?: boolean;
  status?: boolean;
  fields?: {
    name: string;
    type: string;
    localized?: boolean;
    unique?: boolean;
  }[];
}

/**
 * Each kind's configured entities and its table-name rule.
 *
 * The kind travels with each group because it is part of the transition record's key: a
 * collection, a Single and a field group may share one slug, and only one of them may have
 * transitioned. Each kind resolves its table differently, and a custom `dbName` is where they
 * diverge: collections and Singles force their `dc_` / `single_` prefix onto it (and Singles
 * normalize the identifier), while field groups take no override at all. A single shared
 * "prefix + slug" rule would point at a table the runtime never created: `dbName: "forms"` on a
 * collection lives at `dc_forms`, so its companion would be built as `forms_locales` with a
 * foreign key to a table that does not exist.
 */
export function localizableConfigEntities(config: {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
}): [
  I18nTransitionKind,
  LocalizableEntity[],
  (e: LocalizableEntity) => string,
][] {
  return [
    [
      "collection",
      (config.collections ?? []) as LocalizableEntity[],
      e => resolveCollectionTableName(e.slug!, e.dbName),
    ],
    [
      "single",
      (config.singles ?? []) as LocalizableEntity[],
      e => resolveSingleTableName({ slug: e.slug!, dbName: e.dbName }),
    ],
    [
      "fieldGroup",
      (config.fieldGroups ?? []) as LocalizableEntity[],
      e => resolveComponentTableName(e.slug!),
    ],
  ];
}
