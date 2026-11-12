/**
 * Field-group fields renamed since the latest snapshot, as `migrate:create` writes them: the
 * operator is asked about each pair that may be one field renamed, as a column rename is asked
 * about, and an accepted one moves the field's stored rows to the new name inside the migration,
 * with the reverse in its DOWN.
 *
 * The snapshot's table diff cannot see such a rename. A field group's rows live in the group's own
 * table keyed by the parent's table and the field's NAME, and the parent table has no column for
 * it; so the diff is empty, and the only trace of the rename is the entity's recorded declaration
 * (`entity-settings.ts`), whose fields this reads on both sides. Without this the file carried only
 * the settings change, and every stored row stayed keyed by the old name, where nothing reads it.
 *
 * Which pairs may be a rename is the Schema Builder's answer (`keepsFieldGroupRows`), and the
 * statements are the ones its save writes (`fieldGroupRowMoves`). Only the pairing differs: a
 * Builder save holds one rename and refuses more, while this asks about every compatible pair and
 * refuses only answers that give one field two names.
 *
 * @module domains/schema/migrate-create/field-group-renames
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { fieldGroupSlugList } from "../../field-groups/storage/field-group-field-type";
import {
  fieldGroupRowMoves,
  keepsFieldGroupRows,
  removedAndAddedFieldGroups,
  type RenamedFieldShape,
} from "../../field-groups/storage/field-group-rename";
import type { I18nTransitionKind } from "../../i18n/migration/transition-state";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces";

import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
} from "./entity-settings";
import type { RenameDecision } from "./prompt-renames";

/** Where each kind's declarations sit in a snapshot's settings record. */
const RECORD_KEYS: Record<I18nTransitionKind, keyof EntitySettingsRecord> = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
};

/** An entity the run generates for, as `generateMigration` holds it. */
export interface FieldGroupRenameEntity {
  kind: I18nTransitionKind;
  entity: {
    slug: string;
    tableName: string;
    settings?: RecordedEntitySettings;
  };
}

/** What the accepted field-group renames add to the migration. */
export interface FieldGroupRenamePlan {
  /** The statements re-keying each accepted rename's rows, for the UP. */
  up: string[];
  /** Their reverse, for the DOWN. */
  down: string[];
  /** The parent tables whose fields were renamed, which the migration changes. */
  parentTables: Set<string>;
  /** How many renames were accepted. */
  accepted: number;
}

/**
 * The fields a recorded declaration holds, each with its name. A record is the declaration as
 * written, so anything else in the list (an entry without a name) is not a field this can pair.
 */
function declaredFields(
  settings: RecordedEntitySettings | undefined
): RenamedFieldShape[] {
  const list = settings?.settings.fields;
  if (!Array.isArray(list)) return [];
  return list.flatMap(field =>
    field !== null &&
    typeof field === "object" &&
    !Array.isArray(field) &&
    typeof field.name === "string"
      ? [{ ...field, name: field.name }]
      : []
  );
}

/**
 * Asks about every field-group field removed from an entity and added under another name since
 * the latest snapshot's record (`previous`), where the two may hold the same rows, through
 * `decide` (the operator's prompt, or a caller that already knows), and plans the accepted ones.
 *
 * `groupTables` names each field group's table by slug. A pair whose groups have no table here
 * has no rows to move and is not asked about. An entity the record does not hold, or a record from
 * before declarations were recorded, has nothing to compare and asks nothing.
 */
export async function planFieldGroupRenames(args: {
  entities: readonly FieldGroupRenameEntity[];
  previous: EntitySettingsRecord | undefined;
  groupTables: ReadonlyMap<string, string>;
  dialect: SupportedDialect;
  decide: (candidates: RenameCandidate[]) => Promise<RenameDecision[]>;
}): Promise<FieldGroupRenamePlan> {
  const plan: FieldGroupRenamePlan = {
    up: [],
    down: [],
    parentTables: new Set(),
    accepted: 0,
  };
  for (const { kind, entity } of args.entities) {
    const before = args.previous?.[RECORD_KEYS[kind]][entity.slug];
    if (before === undefined || entity.settings === undefined) continue;
    const { oldOnly, newOnly } = removedAndAddedFieldGroups(
      declaredFields(before),
      declaredFields(entity.settings)
    );
    const candidates = oldOnly.flatMap(from =>
      newOnly.flatMap((to): RenameCandidate[] => {
        if (!keepsFieldGroupRows(from, to)) return [];
        const tables = fieldGroupSlugList(to).flatMap(slug => {
          const table = args.groupTables.get(slug);
          return table === undefined ? [] : [table];
        });
        if (tables.length === 0) return [];
        return [
          {
            tableName: entity.tableName,
            fromColumn: from.name,
            toColumn: to.name,
            fromType: "field group",
            toType: "field group",
            typesCompatible: true,
            preservesValues: true,
            defaultSuggestion: "rename",
            fieldGroupTables: tables,
          },
        ];
      })
    );
    if (candidates.length === 0) continue;
    const accepted = (await args.decide(candidates))
      .filter(decision => decision.accepted)
      .map(decision => decision.candidate);
    refuseOneFieldTwoNames(entity.slug, accepted);
    for (const rename of accepted) {
      const groupTables = rename.fieldGroupTables ?? [];
      const move = { dialect: args.dialect, parentTable: entity.tableName };
      plan.up.push(
        ...fieldGroupRowMoves({
          ...move,
          from: rename.fromColumn,
          to: rename.toColumn,
          groupTables,
        })
      );
      plan.down.unshift(
        ...fieldGroupRowMoves({
          ...move,
          from: rename.toColumn,
          to: rename.fromColumn,
          groupTables,
        })
      );
      plan.parentTables.add(entity.tableName);
      plan.accepted += 1;
    }
  }
  return plan;
}

/**
 * Refuses answers that rename one field group to two names, or two to one: moving the rows twice
 * would hand them to whichever ran last, so which field they belong to cannot be known. Happens
 * when `--accept-renames` accepts every pair of an entity that removes or adds more than one
 * field group holding the same groups; at a terminal, each pair can be answered on its own.
 */
function refuseOneFieldTwoNames(
  slug: string,
  accepted: readonly RenameCandidate[]
): void {
  const seen = (side: (c: RenameCandidate) => string) =>
    accepted.some((c, i) => accepted.findIndex(o => side(o) === side(c)) !== i);
  if (!seen(c => c.fromColumn) && !seen(c => c.toColumn)) return;
  const pairs = accepted.map(c => `"${c.fromColumn}" → "${c.toColumn}"`);
  const message =
    `The renames accepted for "${slug}" give a field group more than one name ` +
    `(${pairs.join(", ")}). Each rename moves the group's stored rows to its new name, so ` +
    `only one can be applied per field. Run nextly migrate:create at a terminal and accept one ` +
    `pair for each field, or rename one field group per migration.`;
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage: message,
    publicData: {
      errors: [
        { path: "fields", code: "FIELD_GROUP_RENAME_AMBIGUOUS", message },
      ],
    },
    logContext: { entity: slug, renames: pairs },
  });
}
