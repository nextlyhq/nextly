/**
 * Cases for `db:sync` and its promote and demote steps, and for `migrate:fresh`,
 * `migrate:field-groups` and `i18n:restore`.
 *
 * @module cli/__tests__/error-cases/sync
 */
import {
  chooseRestoreEntity,
  type ResolvedEntityTable,
} from "../../../domains/i18n/migration/resolve-entity-table";
import { NextlyError } from "../../../errors/nextly-error";
import {
  demoteCollectionNotFound,
  promoteCollectionNotFound,
  restoreCollectionRequired,
  restoreEntityRefusal,
} from "../../errors/areas/sync";

import type { ErrorCases } from "./types";

/** A collection and a field group sharing the slug `hero`, as the restore resolves them. */
const HERO: ResolvedEntityTable[] = [
  {
    tableName: "dc_hero",
    companionTableName: "dc_hero_locales",
    kind: "collection",
  },
  {
    tableName: "fg_hero",
    companionTableName: "fg_hero_locales",
    kind: "fieldGroup",
  },
];

/** The refusal `i18n:restore` ends with, from the chooser's own answer for these inputs. */
function restoreRefusal(
  slug: string,
  matches: readonly ResolvedEntityTable[],
  kind?: string
) {
  const chosen = chooseRestoreEntity(slug, matches, kind);
  if (!("problem" in chosen)) throw new Error("expected a refusal");
  return restoreEntityRefusal({
    slug,
    kind,
    found: matches.length,
    problem: chosen.problem,
  });
}

export const SYNC_CASES = {
  PROMOTE_COLLECTION_NOT_FOUND: () => promoteCollectionNotFound("posts"),
  DEMOTE_COLLECTION_NOT_FOUND: () => demoteCollectionNotFound("posts"),
  I18N_RESTORE_COLLECTION_REQUIRED: () => restoreCollectionRequired(),
  I18N_RESTORE_KIND_INVALID: () => restoreRefusal("hero", HERO, "page"),
  I18N_RESTORE_ENTITY_NOT_FOUND: () => restoreRefusal("heroes", []),
  I18N_RESTORE_ENTITY_AMBIGUOUS: () => restoreRefusal("hero", HERO),
  // As `runFieldGroupMigration` in `domains/field-groups/migration/run.ts` throws it.
  FIELD_GROUP_BACKUP_NOT_CONFIRMED: () =>
    NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration refuses to run without a confirmed backup",
      logContext: {
        phase: "field-group-storage-migration",
        reason: "no backup acknowledgement",
        direction: "up",
      },
    }),
  // As `assertNoMigrationInFlight` in `domains/field-groups/migration/sync-guard.ts` throws it.
  FIELD_GROUP_MIGRATION_IN_FLIGHT: () =>
    NextlyError.serviceUnavailable({
      logMessage:
        "db:sync refused: a field group storage migration is in flight",
      logContext: {
        reason: "field group storage migration is in flight",
        direction: "up",
        migrationId: "fg-20261029-1002",
        step: 3,
      },
    }),
  // As `refuse` in `domains/field-groups/migration/reconcile.ts` builds it.
  FIELD_GROUP_STORAGE_REFUSED: () =>
    NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration refused to proceed: registry rows name storage that does not exist",
      logContext: {
        reason: "registry rows name storage that does not exist",
        refusalKind: "permanent",
        missing: ["comp_hero"],
      },
    }),
  // As `provisionLocalization` in `cli/commands/dev-build.ts` refuses the sync.
  LOCALIZATION_NOT_PROVISIONED: () =>
    NextlyError.conflict({
      reason: "state",
      message:
        "Localization could not be brought into step for: posts. Until it succeeds, translations for these entities are either unwritable or unreadable.",
      logContext: {
        reason: "localization-not-provisioned",
        cause: "companion-provisioning-failed",
        entities: ["posts"],
      },
    }),
} satisfies ErrorCases;
