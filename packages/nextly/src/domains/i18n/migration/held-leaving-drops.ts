/**
 * The last step of a companion transition planned with `holdLeavingDrops`: the Required and Unique
 * settings of the fields leaving translation, then their companion columns dropped.
 *
 * The drop is the step that cannot be taken back, so it runs last. A setting the values cannot take
 * is refused before it, and the field is still translated, with every language and its
 * per-language unique index in place: the save can be made again as it was.
 *
 * @module domains/i18n/migration/held-leaving-drops
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { TRANSLATION_SUGGESTIONS_TABLE } from "../../../schemas/translation-suggestions/table-name";
import {
  applyMigrationWhole,
  applyStatementsInTries,
  type BusyTableWait,
} from "../../schema/services/apply-migration-statements";
import type { StructuredField } from "../shared-structure";

import { ensureI18nArchive, runI18nSchemaStatements } from "./ensure-archive";
import type {
  CompanionTransitionPlan,
  FieldRename,
} from "./reconcile-companion";
import type { I18nTransitionKind } from "./transition-state";

/**
 * Runs a companion transition plan for a Schema Builder save: the archive made ready when the plan
 * writes to it, the plan's statements one by one (`applyCompanionStatements`), given a settings step
 * the settings and then the held drops (`dropHeldLeavingFields`), and, when the plan dropped the companion, what was
 * remembered about it forgotten. One function for the collection, Single and field-group paths,
 * so they cannot run a plan differently.
 *
 * 🔴 STRICT on purpose: the companion does NOT tolerate a re-run.
 *
 * Tolerating it would make a half-finished localization ENABLE look like success. Interrupted
 * after the companion is created but before the seed and the main-column drops, the retry is
 * indistinguishable from an orphan repair — the planner cannot tell them apart, because the
 * signal that separates them (`existingMainColumns`) is consumed only on the disable path — so
 * the duplicate columns would be swallowed and the entity recorded as localized while its
 * default-locale content is still stranded on the main table.
 *
 * A loud failure is the worse experience and the safer outcome. It costs the repair of a
 * localized entity whose create half-failed; it prevents silently reporting a migration that did
 * not happen.
 */
export async function applyCompanionTransition(args: {
  adapter: DrizzleAdapter;
  plan: CompanionTransitionPlan;
  /**
   * Where given (a Schema Builder save), the plan's statements and its held drops wait for a table
   * another session is using in short tries, as `nextly migrate` waits; without it, they run once.
   */
  busyTable?: BusyTableWait;
  /** Planned with `holdLeavingDrops`: applies the settings, throwing when they are refused. */
  settleLeaving?: () => Promise<void>;
  kind: I18nTransitionKind;
  slug: string;
  tableName: string;
  /** The translated field this change renames, as the schema dialog decided it. */
  renamed?: FieldRename | null;
  /**
   * The entity's fields as the change leaves them, by which the source text kept for a field it
   * removes or no longer translates goes. Absent, none does but with the companion.
   */
  newFields?: readonly StructuredField[];
}): Promise<void> {
  const { adapter, plan, settleLeaving, busyTable } = args;
  await applyCompanionStatements(adapter, plan, busyTable);
  if (settleLeaving) {
    await settleLeaving();
    await dropHeldLeavingFields(adapter, plan, args.kind, busyTable);
  }
  // The source text kept for its translations first: the records' move below may fail, and text
  // still under the old name would read as a removed field's to the next `nextly migrate`.
  if (args.kind === "collection" || args.kind === "single") {
    await settleSourceText(
      adapter,
      { scopeKind: args.kind, scopeSlug: args.slug },
      {
        renamed: args.renamed,
        fields: plan.companionDropped ? [] : args.newFields,
      }
    );
  }
  // A renamed translated field keeps its records of where each language's value came from, under
  // its new name. Moved here, once its column has been, rather than among the plan's statements,
  // which a migration file may carry: the records are data, not schema. The translations suggested
  // for the field move before its records, so a failure of either leaves the records where the
  // answer says they are.
  if (args.renamed && (args.kind === "collection" || args.kind === "single")) {
    const { renameFieldProvenance, renameFieldProvenanceStatements } =
      await import("../provenance/record-provenance");
    const { renameFieldSuggestions, renameFieldSuggestionsStatements } =
      await import("../pipeline/suggestion-rows");
    const rename = {
      scopeKind: args.kind,
      scopeSlug: args.slug,
      from: args.renamed.from,
      to: args.renamed.to,
    };
    let suggestionsKept = false;
    try {
      suggestionsKept = await adapter.tableExists(
        TRANSLATION_SUGGESTIONS_TABLE
      );
      if (suggestionsKept) {
        await adapter.transaction(tx => renameFieldSuggestions(tx, rename));
      }
      await renameFieldProvenance(adapter, rename);
    } catch (error) {
      // The change has landed by now (its columns moved, its file recorded), so the failure says
      // so, and what finishes it: no later save knows of the rename to move the records again.
      // The statements go to the server log here, whichever entity's save this is, as the answer
      // tells a developer to find them there.
      const { dialect } = adapter.getCapabilities();
      const statements = [
        ...renameFieldProvenanceStatements(dialect, rename),
        ...(suggestionsKept
          ? renameFieldSuggestionsStatements(dialect, rename)
          : []),
      ];
      const failure = provenanceNotMoved(error, rename, statements);
      const [{ getLoggerFromDI }, { consoleLogger }] = await Promise.all([
        import("../../../dispatcher/helpers/di"),
        import("../../../shared/types"),
      ]);
      (getLoggerFromDI() ?? consoleLogger).error(
        `[translations step] The translation records of ${rename.scopeKind} '${rename.scopeSlug}' were not moved after its rename: ${failure.logMessage ?? ""}. Run these to finish it:\n${statements.join("\n")}`
      );
      throw failure;
    }
  }
  // The transition record describes a companion that no longer exists, so it stops being true the
  // moment the disable succeeds. Left behind, it would refuse the next enable's real source locale:
  // the check that protects a live transition would block a legitimate one instead.
  if (plan.companionDropped) {
    // The other half of "this companion is gone": readiness remembers only that one exists.
    const { forgetCompanionReadiness } = await import(
      "../runtime/companion-readiness"
    );
    forgetCompanionReadiness(adapter, `${args.tableName}_locales`);
    const { resolveTransitionStore } = await import("./transition-recorder");
    const { forgetI18nTransition } = await import("./transition-state");
    await forgetI18nTransition(
      await resolveTransitionStore(adapter),
      args.kind,
      args.slug
    );
    // Nothing is translated any more, so there is no text left to suggest a translation for.
    const { removeEntitySuggestions } = await import(
      "./entity-translation-rows"
    );
    await removeEntitySuggestions(adapter, args.kind, args.slug);
  }
}

/**
 * The source text kept for the entity's translations, after its change: a renamed field's moves to
 * its new name, and that of a field removed or no longer translated (`fields`, those left) goes.
 * The change has landed by now, and text left under an old name is found under no field: a failure
 * is logged, not answered, with the statements that finish a rename's move. Until they are run the
 * text is missing where it is asked for, and the next `nextly migrate` removes what stayed.
 */
async function settleSourceText(
  adapter: DrizzleAdapter,
  scope: { scopeKind: "collection" | "single"; scopeSlug: string },
  change: {
    renamed?: FieldRename | null;
    fields?: readonly StructuredField[];
  }
): Promise<void> {
  if (!change.renamed && change.fields === undefined) return;
  try {
    const { removeFieldSources, renameFieldSources, translatedFieldNames } =
      await import("../provenance/removed-field-sources");
    if (change.renamed) {
      await renameFieldSources(adapter, scope, change.renamed);
    }
    if (change.fields !== undefined) {
      const translated = translatedFieldNames(change.fields, true);
      await removeFieldSources(adapter, scope, field => !translated.has(field));
    }
  } catch (error) {
    const [
      { getLoggerFromDI },
      { consoleLogger },
      { renameFieldProvenanceStatements },
      { TRANSLATION_SOURCES_TABLE },
    ] = await Promise.all([
      import("../../../dispatcher/helpers/di"),
      import("../../../shared/types"),
      import("../provenance/record-provenance"),
      import("../../../schemas/translation-sources"),
    ]);
    const statements = change.renamed
      ? renameFieldProvenanceStatements(
          adapter.getCapabilities().dialect,
          { ...scope, ...change.renamed },
          TRANSLATION_SOURCES_TABLE
        )
      : [];
    (getLoggerFromDI() ?? consoleLogger).error(
      [
        `[translations step] The source text kept for ${scope.scopeKind} '${scope.scopeSlug}' was not brought in step with its change: ${error instanceof Error ? error.message : String(error)}`,
        ...(statements.length > 0
          ? [
              "Run these before the next `nextly migrate` to keep it:",
              ...statements,
            ]
          : []),
      ].join("\n")
    );
  }
}

/** What a provenance move that failed after its change landed is marked with (`provenanceNotMoved`). */
const PROVENANCE_NOT_MOVED = "translation-records-not-moved";

/**
 * The failure of a renamed field's provenance move, once its change has landed: the admin is told
 * the change landed, which records stayed under the old name and what that costs, and that a
 * developer can finish it; the statements that do (`renameFieldProvenanceStatements`) and the
 * cause go with it for the server log, never in the answer, which may reach someone with no
 * database to run them on.
 */
function provenanceNotMoved(
  error: unknown,
  rename: {
    scopeKind: "collection" | "single";
    scopeSlug: string;
    from: string;
    to: string;
  },
  statements: string[]
): NextlyError {
  const notMoved = `its translations step failed, so the translation records of "${rename.from}" were not moved to "${rename.to}". Until they are, no language of ${rename.to} can be found out of date.`;
  // Where the save ran its own migration file, the file is recorded and the Single's or
  // Collection's row is written with the change, so the answer ends here. A Collection's push
  // that stops part way adds its kept files' steps after it (`partWayPush`).
  const publicMessage =
    rename.scopeKind === "single"
      ? `Single "${rename.scopeSlug}" was saved: its change landed, but ${notMoved} A developer can finish it with the statements in the server log.`
      : `Collection "${rename.scopeSlug}" was saved only in part: its change landed in the database, but ${notMoved} A developer can move them with the statements in the server log.`;
  return new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage,
    logMessage: error instanceof Error ? error.message : String(error),
    logContext: { reason: PROVENANCE_NOT_MOVED, ...rename, statements },
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

/**
 * Whether `error` is a renamed field's provenance move that failed after its change landed
 * (`provenanceNotMoved`): its caller records the change, as it did land, and passes it on as it is.
 */
export function isProvenanceNotMoved(error: unknown): error is NextlyError {
  return (
    NextlyError.is(error) && error.logContext?.reason === PROVENANCE_NOT_MOVED
  );
}

/**
 * A plan's statements, before any held drop: the archive made ready first when the plan writes to
 * it, as an entity with no `nextly migrate` step has none provisioned (idempotent), then each
 * statement. Apart, so a caller moving several entities' fields runs every entity's statements
 * before any settings or drop (`moveFieldsLeavingOnReload`).
 */
export async function applyCompanionStatements(
  adapter: DrizzleAdapter,
  plan: Pick<CompanionTransitionPlan, "needsArchive" | "statements">,
  busyTable?: BusyTableWait
): Promise<void> {
  if (plan.needsArchive) {
    await ensureI18nArchive(adapter, adapter.dialect);
  }
  if (busyTable !== undefined) {
    // The same one-at-a-time run, strict, waiting for a busy table in short tries.
    await applyStatementsInTries(
      busyTable,
      plan.statements,
      "the translations table's change"
    );
    return;
  }
  // One at a time: `executeQuery` runs a single statement on some drivers, SQLite's among them.
  // Each waits for a table another database session holds in short tries, then stops with
  // `NEXTLY_TABLE_BUSY` naming it and its holder, rather than holding the save without bound.
  await runI18nSchemaStatements(
    adapter,
    plan.statements,
    "the localization change"
  );
}

/**
 * The plan's `leavingDrops` whole, once the settings hold: in one transaction on PostgreSQL and
 * SQLite, so each column's last archive and copy land with its drop or not at all; statement by
 * statement on MySQL, which commits each schema statement. `entity` names what they change, for
 * the log.
 */
export async function dropHeldLeavingFields(
  adapter: DrizzleAdapter,
  plan: Pick<CompanionTransitionPlan, "leavingDrops">,
  entity: string,
  busyTable?: BusyTableWait
): Promise<void> {
  const drops = plan.leavingDrops ?? [];
  if (drops.length === 0) return;
  // Run as one unit in short tries for a table another database session holds: a try that waited
  // is rolled back whole on PostgreSQL and SQLite and the next runs the drops again from the first,
  // and the tries stop with `NEXTLY_TABLE_BUSY` naming the table and its holder rather than holding
  // the save without bound (`runUnitInTries`). Inside an open transaction, where a unit of its own
  // is refused, they run once, whole, as before.
  if (!adapter.inTransaction()) {
    const [{ runUnitInTries }, { busyTableBounds }, { consoleLogger }] =
      await Promise.all([
        import("../../schema/busy-table/run-unit"),
        import("../../schema/busy-table/bounds"),
        import("../../../shared/types"),
      ]);
    await runUnitInTries(
      adapter,
      drops,
      {
        source: `the drop of the ${entity}'s columns leaving translation`,
        transaction: true,
      },
      () => Promise.resolve(),
      {
        bounds: busyTableBounds({ env: process.env }),
        notify: line => consoleLogger.warn(line),
        appliedBefore: () => [],
      }
    );
    return;
  }
  await applyMigrationWhole({
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    migrationSQL: drops.join("\n--> statement-breakpoint\n"),
    entity,
    ...(busyTable === undefined ? {} : { busyTable }),
  });
}
