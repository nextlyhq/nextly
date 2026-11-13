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

import {
  applyMigrationWhole,
  applyStatementsInTries,
  type BusyTableWait,
} from "../../schema/services/apply-migration-statements";

import { ensureI18nArchive } from "./ensure-archive";
import type { CompanionTransitionPlan } from "./reconcile-companion";
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
}): Promise<void> {
  const { adapter, plan, settleLeaving, busyTable } = args;
  await applyCompanionStatements(adapter, plan, busyTable);
  if (settleLeaving) {
    await settleLeaving();
    await dropHeldLeavingFields(adapter, plan, args.kind, busyTable);
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
  }
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
  for (const statement of plan.statements) {
    await adapter.executeQuery(statement);
  }
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
  await applyMigrationWhole({
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    migrationSQL: drops.join("\n--> statement-breakpoint\n"),
    entity,
    ...(busyTable === undefined ? {} : { busyTable }),
  });
}
