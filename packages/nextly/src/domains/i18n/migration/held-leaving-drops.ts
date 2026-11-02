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

import { applyMigrationWhole } from "../../schema/services/apply-migration-statements";

import { ensureI18nArchive } from "./ensure-archive";
import type { CompanionTransitionPlan } from "./reconcile-companion";
import type { I18nTransitionKind } from "./transition-state";

/**
 * Runs a companion transition plan for a Schema Builder save: the archive made ready when the plan
 * writes to it, the plan's statements one by one, given a settings step the settings and then the
 * held drops (`settleThenDropLeavingFields`), and, when the plan dropped the companion, what was
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
  /** Planned with `holdLeavingDrops`: applies the settings, throwing when they are refused. */
  settleLeaving?: () => Promise<void>;
  kind: I18nTransitionKind;
  slug: string;
  tableName: string;
}): Promise<void> {
  const { adapter, plan, settleLeaving } = args;
  // A disable archives non-default translations, so the archive is made ready first: Builder
  // entities have no `nextly migrate` step to provision it. Idempotent.
  if (plan.needsArchive) {
    await ensureI18nArchive(adapter, adapter.dialect);
  }
  // One at a time: `executeQuery` runs a single statement on some drivers, SQLite's among them.
  for (const statement of plan.statements) {
    await adapter.executeQuery(statement);
  }
  if (settleLeaving) {
    await settleThenDropLeavingFields({
      adapter,
      plan,
      settleLeaving,
      entity: args.kind,
    });
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
 * Runs `settleLeaving`, then the plan's `leavingDrops` whole: in one transaction on PostgreSQL and
 * SQLite, so each column's last archive and copy land with its drop or not at all; statement by
 * statement on MySQL, which commits each schema statement.
 */
async function settleThenDropLeavingFields(args: {
  adapter: DrizzleAdapter;
  plan: Pick<CompanionTransitionPlan, "leavingDrops">;
  /** Applies the settings, throwing when they are refused. */
  settleLeaving: () => Promise<void>;
  /** What the drops change, for the log. */
  entity: string;
}): Promise<void> {
  await args.settleLeaving();
  const drops = args.plan.leavingDrops ?? [];
  if (drops.length === 0) return;
  await applyMigrationWhole({
    db: args.adapter.getDrizzle(),
    dialect: args.adapter.getCapabilities().dialect,
    migrationSQL: drops.join("\n--> statement-breakpoint\n"),
    entity: args.entity,
  });
}
