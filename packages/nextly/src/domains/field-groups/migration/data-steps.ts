/**
 * Turns the field-group vocabulary rewrites into migration steps.
 *
 * These steps move what is *inside* rows; `steps.ts` moves the tables and
 * columns the rows live in. They are built separately because the two are
 * different work with different guarantees — a rename is DDL and is only atomic
 * on two of the three dialects, while every rewrite here is ordinary DML and
 * commits or does not.
 *
 * 🔴 **These steps run before any rename, in both directions.** That is not a
 * preference. The adapter's typed CRUD resolves a table through the schema
 * registry and refuses any name the ORM does not declare, and the field-group
 * registry is declared under its legacy name — so it is reachable through that
 * path only while it still carries it. Going through the ORM is what makes the
 * driver's JSON encoding the ORM's problem rather than this module's: the same
 * column is `jsonb` on Postgres, `json` on MySQL and text-with-a-json-mode on
 * SQLite, and two of the three hand back an object where the third hands back a
 * string. Ordering the plan so that never has to be discovered here is worth
 * more than the freedom to put these steps anywhere.
 *
 * Inverting the plan puts them last on the way down, by which point the renames
 * have restored the names they address. So the same rule holds in both
 * directions, and no step here has to work out which name a table is currently
 * under.
 *
 * @module domains/field-groups/migration/data-steps
 */

import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { databaseNowMs } from "../../limits/store-clock";
import type { MetaService } from "../../meta/services/meta-service";

import { MIGRATION_TARGET } from "./manifest";
import { rewriteContentKey } from "./rewrite-content-key";
import {
  findUnrewrittenRow,
  rewriteRowsInBatches,
  type RowRewriteTarget,
} from "./rewrite-rows";
import type { MigrationStep } from "./runner";
import type { MigrationSession } from "./session";

/**
 * Every spelling of the field-group concept this migration is ALLOWED to move.
 *
 * One object rather than loose arguments so a direction is a single value: a
 * rollback passes the same pair the other way round, and no caller can swap one
 * half of a vocabulary while leaving the rest.
 *
 * 🔴 **Membership is a claim that the running code can still read the value
 * after it moves.** A migration that writes a spelling no reader accepts does
 * not degrade — the data is intact and unreadable, which presents as the
 * application failing rather than as a storage problem, so nothing points at
 * the migration that caused it.
 *
 * Two mechanisms make a moved spelling readable, and they cover different kinds
 * of name:
 *
 * - a **catalog object** — a table or a column — is resolved by probing the
 *   live catalog, which is what `storage/resolve-storage-names.ts` does. Those
 *   names are moved by `steps.ts` and never appear here.
 * - a **token inside stored JSON** cannot be probed, because there is nothing to
 *   introspect. It is readable after moving only if some accessor tries both
 *   spellings, which is what `storage/field-group-type-key.ts` does for the one
 *   member below.
 *
 * So a token belongs here only once its dual read exists. `wireTypeKey` is the
 * only in-JSON spelling that qualifies today.
 *
 * The field-group vocabulary carries four more in-JSON spellings — a stored
 * field definition's `type` and its reference keys, a registry row's
 * `config_path` directory, and a schema event's scope. `MIGRATION_TARGET`
 * declares where each is going and this migration deliberately does not take
 * them there: every one is read through `STORAGE_FORMAT` alone, by eighteen
 * product files in the case of `type`. **Adding one here without first writing
 * its accessor is what stops the application booting.**
 */
export interface FieldGroupStorageVocabulary {
  /**
   * The key a dynamic-zone instance announces its type under, once it is JSON.
   *
   * Readable after it moves because `readFieldGroupType` tries both spellings,
   * current first — which is also what makes a half-rewritten database safe
   * rather than merely survivable.
   */
  readonly wireTypeKey: string;
}

/** What deployed databases spell today. */
export const LEGACY_STORAGE_VOCABULARY: FieldGroupStorageVocabulary = {
  wireTypeKey: STORAGE_FORMAT.wireTypeKey,
};

/** What they spell afterwards. */
export const FIELD_GROUP_STORAGE_VOCABULARY: FieldGroupStorageVocabulary = {
  wireTypeKey: MIGRATION_TARGET.wireTypeKey,
};

/**
 * Ledgers carrying the wire key inside a stored document.
 *
 * Both grow with a site's activity rather than with its schema, so both are
 * walked in batches. `nextly_events` was planned as small and bounded; it is a
 * ledger under a retention window exactly like `nextly_versions`, and sizing one
 * for growth but not the other would be a guess about which fills up first.
 */
const CONTENT_TARGETS: readonly RowRewriteTarget[] = [
  // A version's autosave rewrites its row in place, so its last write is `updatedAt`.
  {
    table: "nextly_versions",
    documentProperty: "snapshot",
    writtenAt: ["updatedAt", "createdAt"],
  },
  {
    table: "nextly_events",
    documentProperty: "payload",
    writtenAt: ["createdAt"],
  },
];

/**
 * The moment a content step began, on the database's clock, to the whole second: the precision
 * SQLite keeps its timestamps at. A row written in the same second counts as written during the
 * step; one that existed then was read by the step's walk, which rewrites every row it reads.
 *
 * The database's clock, not this process's: the database stamps the events ledger's rows itself,
 * and a host whose clock runs apart from it would count rows written during the step as older
 * than it (and refuse a run under traffic), or a row the walk missed as newer (and pass over it).
 */
async function stepBeganAt(session: MigrationSession): Promise<Date> {
  const rows = await session.inTransaction(ctx =>
    ctx.queryStatement<{ now: unknown }>(
      sql`SELECT ${databaseNowMs(session.dialect)} AS ${sql.identifier("now")}`
    )
  );
  // PostgreSQL hands a bigint back as a string; every dialect's answer reads as a number.
  const now = Number(rows[0]?.now);
  if (!Number.isFinite(now)) {
    throw NextlyError.internal({
      logContext: {
        reason: "the database did not answer its clock",
        answer: String(rows[0]?.now),
      },
    });
  }
  return new Date(Math.floor(now / 1000) * 1000);
}

/** What rewrites a stored document's wire key from one vocabulary to the other. */
function wireKeyRewrite(
  from: FieldGroupStorageVocabulary,
  to: FieldGroupStorageVocabulary
): (document: unknown) => unknown {
  return document =>
    rewriteContentKey(document, from.wireTypeKey, to.wireTypeKey);
}

/**
 * Ask the ledger surfaces whether they are still rewritten, and refuse if not.
 *
 * The question {@link settleLedgersStep}'s verify asks, asked without changing anything: a step's
 * own verify rewrites rows written while it ran before it answers, and this only reads, so a
 * caller can ask it of a database without running, or finishing, a migration.
 *
 * @throws the refusal a step's verify raises (`unrewrittenRowRefusal`), naming the first ledger
 * and row still carrying the old vocabulary.
 */
export async function assertLedgersSettled(args: {
  session: MigrationSession;
  meta: MetaService;
  migrationId: string;
  from: FieldGroupStorageVocabulary;
  to: FieldGroupStorageVocabulary;
}): Promise<void> {
  const rewrite = wireKeyRewrite(args.from, args.to);
  for (const target of CONTENT_TARGETS) {
    const row = await findUnrewrittenRow({
      session: args.session,
      target,
      rewrite,
    });
    // The refusal a step's own verify raises, so the two name a surface and a row alike.
    if (row !== undefined) throw unrewrittenRowRefusal(target, row);
  }
}

/**
 * The refusal for a ledger row still carrying the old vocabulary. Named rather than merely
 * reported false: a row the walk did not reach is not "not finished yet" (the walk ran to the end
 * of the table), so an operator needs the row to look at, and a retry needs to be understood as a
 * retry of something that already claimed to be done.
 */
function unrewrittenRowRefusal(
  target: RowRewriteTarget,
  row: string
): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration left a row carrying the old vocabulary: ${target.table}`,
    logContext: {
      reason: "row rewrite did not reach every row",
      table: target.table,
      property: target.documentProperty,
      row,
    },
  });
}

/**
 * The last step of an upward plan: re-rewrite the ledgers, then re-check them.
 *
 * 🔴 A plan STEP rather than a post-hoc assertion, and the difference is the
 * whole recovery story. `runMigrationSteps` runs a step, verifies it, and
 * records it only when it verifies — so a step that cannot reach its state is
 * retried by the next invocation. An assertion placed after the loop has no such
 * property: it throws with every step already recorded, the next run resumes
 * past them all, reaches the same assertion and refuses again. **A refusal that
 * a retry cannot clear is not a safety net, it is a trap.**
 *
 * Its `run` re-runs the ledger rewrites, which is what makes the common case
 * self-healing: a straggler row committed after its original step is simply
 * rewritten here. Its `verify` rewrites once more and then refuses for a row
 * written before this step began that still carries the old key: the walk
 * reached the end of the table, so such a row is a defect. A row written since
 * is a server saving, under the key every writer still writes, and readers
 * accept both; it is not waited for, or no site under traffic would settle.
 *
 * One row is outside that rule: one stamped before this step began by a transaction that commits
 * after the last pass. Committed before the check, it reads as missed and the run refuses, naming
 * it, and the next `--apply` rewrites it. Committed after the check, it is not seen at all and keeps
 * the old key, which readers accept.
 *
 * Up only. Going down the data steps come last, so their own verify is already
 * the final word; going up the renames follow them, and a write landing during
 * those renames is behind every ledger check the plan has left.
 */
export function settleLedgersStep(args: {
  meta: MetaService;
  migrationId: string;
  from: FieldGroupStorageVocabulary;
  to: FieldGroupStorageVocabulary;
}): MigrationStep {
  const ledgers = buildDataMigrationSteps(args);
  return {
    id: "data:settle-ledgers",
    // A gate: re-entered by every invocation rather than recorded. A recorded
    // position is what lets a later run step over something, and this must be
    // true at the moment the marker settles.
    recordsProgress: false,
    async run(session) {
      for (const step of ledgers) await step.run(session);
    },
    async verify(session) {
      for (const step of ledgers) {
        if (!(await step.verify(session))) return false;
      }
      return true;
    },
  };
}

/**
 * Build the steps that rewrite stored vocabulary, in canonical order.
 *
 * Direction is which vocabulary is passed as which argument. A rollback is this
 * call with the two exchanged, and the resulting steps reversed along with the
 * rest of the plan.
 *
 * Every step here addresses a ledger, and that is now a property of the list
 * rather than a subset of it: the only spelling this migration moves inside a
 * row is the wire key, which lives in stored documents that no rename touches.
 * The settlement gate therefore re-runs this same list instead of selecting
 * from it — two builders agreeing on the same question is what drifts.
 */
export function buildDataMigrationSteps(args: {
  meta: MetaService;
  migrationId: string;
  from: FieldGroupStorageVocabulary;
  to: FieldGroupStorageVocabulary;
}): MigrationStep[] {
  const { meta, migrationId, from, to } = args;

  return CONTENT_TARGETS.map(target =>
    contentStep({ meta, migrationId, target, from, to })
  );
}

/**
 * Rewrite the wire key inside one ledger's stored documents.
 *
 * Batched and checkpointed, because these are the tables whose size follows a
 * site's history. `verify` rescans the whole table rather than trusting where
 * the batches got to, which is what keeps the checkpoint an optimisation: a
 * cursor that was wrong fails the step instead of passing one that skipped rows.
 *
 * The site stays up while this runs, so a server saving content writes rows
 * under the spelling it knows while the step walks. `verify` rewrites those in
 * one more pass, then decides on the rows written before the step began: a row
 * written since is one a complete rewrite at that moment would not have touched
 * either, and a site that never stops saving would keep any check that counted
 * it from ever passing.
 */
function contentStep(args: {
  meta: MetaService;
  migrationId: string;
  target: RowRewriteTarget;
  from: FieldGroupStorageVocabulary;
  to: FieldGroupStorageVocabulary;
}): MigrationStep {
  const { meta, migrationId, target, from, to } = args;
  const stepId = `data:${target.table}.${target.documentProperty}`;
  const rewrite = wireKeyRewrite(from, to);
  // When this process's run of the step began; a verify with no run before it judges every row.
  let began: Date | undefined;

  return {
    id: stepId,
    async run(session) {
      began = await stepBeganAt(session);
      await rewriteRowsInBatches({
        session,
        meta,
        migrationId,
        stepId,
        target,
        rewrite,
      });
    },
    async verify(session) {
      // Rows written while the step ran carry the spelling their writer knows: rewritten by one
      // more pass, as the first would have, so less is left behind.
      if (
        (await findUnrewrittenRow({ session, target, rewrite })) !== undefined
      ) {
        await rewriteRowsInBatches({
          session,
          meta,
          migrationId,
          stepId,
          target,
          rewrite,
        });
      }
      // Decided on the rows written before the step began: one of those the walk missed is a
      // defect, while one written since is traffic.
      const unrewritten = await findUnrewrittenRow({
        session,
        target,
        rewrite,
        ...(began === undefined ? {} : { writtenBefore: began }),
      });
      if (unrewritten === undefined) return true;
      throw unrewrittenRowRefusal(target, unrewritten);
    },
  };
}
