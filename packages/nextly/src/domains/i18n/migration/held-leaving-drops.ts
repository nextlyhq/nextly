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

import type { CompanionTransitionPlan } from "./reconcile-companion";

/**
 * Runs `settleLeaving`, then the plan's `leavingDrops` whole: in one transaction on PostgreSQL and
 * SQLite, so each column's last archive and copy land with its drop or not at all; statement by
 * statement on MySQL, which commits each schema statement.
 */
export async function settleThenDropLeavingFields(args: {
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
