/**
 * Listing the archived translations no entity can be found for: an archive row of unknown kind
 * (written before the archive recorded an entity's kind) or of unresolved kind (one the labelling
 * pass could not give an owner). Nothing about them is guessed, and nothing removes them: the dry
 * run names each slug, how many rows it has, and the restore that would claim them once the
 * developer says which entity the slug names.
 *
 * Report-only: it has nothing to change, so its count is always 0.
 *
 * @module cli/commands/upgrade-steps/localisation-archive
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  UNKNOWN_ARCHIVE_KIND,
  UNRESOLVED_ARCHIVE_KIND,
} from "../../../schemas/nextly-i18n-archive";
import type { UpgradeReport, UpgradeStepContext } from "../upgrade-step";

const ARCHIVE = "nextly_i18n_archive";

/** What the dry run lists: each slug with archived translations of no known entity. */
export async function unclaimedArchiveReport(
  context: UpgradeStepContext
): Promise<UpgradeReport> {
  const report: UpgradeReport = { move: [], conflicts: [], check: [] };
  if (!(await context.adapter.tableExists(ARCHIVE))) return report;
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const rows = await adapter.select<{ collection: string }>(ARCHIVE, {
    columns: ["collection"],
    where: {
      or: [
        { column: "entityKind", op: "=", value: UNKNOWN_ARCHIVE_KIND },
        { column: "entityKind", op: "=", value: UNRESOLVED_ARCHIVE_KIND },
      ],
    },
  });
  const bySlug = new Map<string, number>();
  for (const { collection } of rows) {
    bySlug.set(collection, (bySlug.get(collection) ?? 0) + 1);
  }
  for (const [slug, count] of [...bySlug].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    report.check.push(
      `${count} archived translation${count === 1 ? "" : "s"} of "${slug}" belong to no entity the site holds; they are kept. ` +
        `Restore them once you know which entity "${slug}" names: \`nextly i18n:restore --collection ${slug} --kind <collection|single|field-group>\``
    );
  }
  return report;
}
