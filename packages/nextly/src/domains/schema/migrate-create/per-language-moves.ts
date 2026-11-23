/**
 * Which of a diff's column drops are text-like fields moving to their entity's per-language table,
 * rather than values removed: the drops the migration commands name as moves
 * (`per-language-move-guidance.ts`).
 *
 * Derived from the same spec the companion planner builds each per-language table from
 * (`deriveCompanionSpec`), one field at a time so each moving column is traced to its field, so a
 * column named here as moving is one the planner would move.
 *
 * @module domains/schema/migrate-create/per-language-moves
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import type { I18nTransitionKind } from "../../i18n/migration/transition-state";
import type { PerLanguageMove } from "../../i18n/per-language-move-guidance";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import type { Operation } from "../pipeline/diff/types";
import { builtByFor } from "../pipeline/registered-collections";

import type { MinimalConfigEntity } from "./generate";

/** The declared entities, by the kind of list each came from. */
export interface EntitiesByKind {
  collections: readonly MinimalConfigEntity[];
  singles: readonly MinimalConfigEntity[];
  components: readonly MinimalConfigEntity[];
}

/**
 * Each entity whose `operations` drop a main-table column that its per-language table takes, with
 * the fields those columns belong to. Empty where no drop is such a move.
 */
export function perLanguageMovesIn(
  operations: readonly Operation[],
  entities: EntitiesByKind,
  dialect: SupportedDialect
): PerLanguageMove[] {
  const dropped = new Set(
    operations.flatMap(op =>
      op.type === "drop_column" ? [`${op.tableName}::${op.columnName}`] : []
    )
  );
  if (dropped.size === 0) return [];
  const tagged: [MinimalConfigEntity, I18nTransitionKind][] = [
    ...entities.collections.map(e => [e, "collection"] as const),
    ...entities.singles.map(e => [e, "single"] as const),
    ...entities.components.map(e => [e, "fieldGroup"] as const),
  ];
  return tagged.flatMap(([entity, kind]) => {
    const move = moveOf(entity, kind, dropped, dialect);
    return move === undefined ? [] : [move];
  });
}

/** One entity's fields whose main-table columns are among `dropped` and go to its companion. */
function moveOf(
  entity: MinimalConfigEntity,
  kind: I18nTransitionKind,
  dropped: ReadonlySet<string>,
  dialect: SupportedDialect
): PerLanguageMove | undefined {
  if (!storesPerLanguage(entity)) return undefined;
  let move: PerLanguageMove | undefined;
  for (const field of entity.fields) {
    // Only the column names are read, so the language the spec's statements would seed is
    // immaterial here.
    const spec = deriveCompanionSpec({
      builtBy: builtByFor(kind, entity.settings?.source === "builder"),
      slug: entity.slug,
      kind,
      dbName: entity.tableName,
      fields: [field],
      dialect,
      defaultLocale: "en",
      collectionLocalized: true,
    });
    const columns = (spec?.columns ?? [])
      .map(c => c.name)
      .filter(c => dropped.has(`${spec?.mainTable}::${c}`));
    if (spec === null || columns.length === 0) continue;
    move ??= {
      table: spec.mainTable,
      localesTable: spec.companionTable,
      fields: [],
      columns: [],
    };
    move.fields.push({ name: field.name, type: field.type });
    move.columns.push(...columns);
  }
  return move;
}
