/**
 * Names, at boot, each configured translated field marked unique whose companion has no
 * per-language index yet, with the commands that create it.
 *
 * The boot never changes the schema, so it does not create the index; `db:sync` does in
 * development and a migration does everywhere else. Until one runs, the rule is not enforced,
 * and saying so at every start is what keeps that from passing unnoticed.
 *
 * @module domains/i18n/runtime/translated-unique-boot-check
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { readIndexNames } from "../../schema/pipeline/live-table-facts";
import {
  companionUniqueIndexName,
  uniqueTranslatedColumns,
} from "../migration/companion-unique-indexes";

import { companionTableExists } from "./companion-io";
import {
  localizableConfigEntities,
  type LocalizableEntity,
} from "./localizable-config-entities";

type BootCheckAdapter = Pick<
  DrizzleAdapter,
  "dialect" | "getDrizzle" | "executeQuery"
>;

/**
 * Warns once per entity whose translated unique fields lack their index. Asks the database
 * nothing about an entity with no such field, which is nearly every entity.
 */
export async function warnAboutUnindexedTranslatedUnique(
  adapter: BootCheckAdapter,
  config: Parameters<typeof localizableConfigEntities>[0],
  warn: (message: string) => void
): Promise<void> {
  for (const [, entities, tableNameOf] of localizableConfigEntities(config)) {
    for (const entity of entities) {
      if (!entity.slug || entity.localized !== true) continue;
      const missing = await unindexedFields(
        adapter,
        entity.fields ?? [],
        `${tableNameOf(entity)}_locales`
      );
      if (missing.length === 0) continue;
      const named = missing.map(field => `"${field}"`).join(", ");
      warn(
        `[nextly] "${entity.slug}": ${named} ${missing.length === 1 ? "is" : "are"} ` +
          `translated and unique, but each language's values are not held unique yet. Run ` +
          `\`nextly migrate:create\` and then \`nextly migrate\` (or \`nextly db:sync\` in ` +
          `development) to add the index.`
      );
    }
  }
}

/** The translated unique fields whose index the companion lacks; none when it is absent. */
async function unindexedFields(
  adapter: BootCheckAdapter,
  fields: NonNullable<LocalizableEntity["fields"]>,
  companionTable: string
): Promise<string[]> {
  const { dialect } = adapter;
  const wanted = uniqueTranslatedColumns({
    fields,
    entityLocalized: true,
    dialect,
    builtBy: "codeFirst",
  });
  if (wanted.length === 0) return [];
  // An absent companion is reported by the boot's own companion provisioning.
  if (!(await companionTableExists(adapter, companionTable))) return [];
  const live = await readIndexNames(
    adapter.getDrizzle(),
    dialect,
    companionTable
  );
  return wanted
    .filter(c => !live.has(companionUniqueIndexName(companionTable, c.column)))
    .map(c => c.field);
}
