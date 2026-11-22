/**
 * The seeding step that audits a change the configuration made to a
 * collection's closed-to-super-admin mark, kept apart from the rest of the
 * seeding so each start's steps can be stood in for one at a time.
 *
 * @module init/record-declared-closed-marks
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getService } from "../di/service-access";
import type { Logger } from "../shared/types";

/**
 * Writes an audit row for each change the configuration made to a
 * collection's closed-to-super-admin mark, the first time a `nextly migrate`
 * or a development start applies it (`applyDeclaredClosedMarks`): the
 * configuration's change takes effect there, so that is when it is recorded,
 * by Nextly itself rather than a person. `adapterFor` hands the audit writer
 * the connection this run writes through.
 */
export async function recordDeclaredClosedMarks(
  adapter: DrizzleAdapter,
  logger: Logger,
  collections: ReadonlyArray<{ slug: string; closedToSuperAdmin?: boolean }>,
  adapterFor: () => DrizzleAdapter
): Promise<void> {
  // Loaded here, as the other steps load theirs, rather than with this
  // module, which every start imports.
  const [
    { MetaService },
    { applyDeclaredClosedMarks },
    { buildAuditLogWriter },
    { changingRoleGrants },
    { expireContentAfterGrantsChange },
  ] = await Promise.all([
    import("../domains/meta/services/meta-service"),
    import("../domains/meta/closed-to-super-admin-marks"),
    import("../domains/audit/audit-log-writer"),
    import("../domains/auth/services/role-grants-changed"),
    import("../domains/flush-content-change"),
  ]);
  // A change of a mark expires every cached content read, as a change of
  // grants does, so no read cached before a close is served after it; queued
  // before the write, and withdrawn where nothing changed.
  const changes = await changingRoleGrants(async () => {
    const applied = await applyDeclaredClosedMarks(
      {
        meta: new MetaService(adapter, logger),
        transaction: work => adapter.transaction(tx => work(tx.getDrizzle())),
      },
      collections
    );
    if (applied.length > 0) await expireContentAfterGrantsChange();
    return applied;
  });
  if (changes.length === 0) return;
  const audit = buildAuditLogWriter((name: string) =>
    name === "adapter" ? adapterFor() : getService(name as "logger")
  );
  for (const { collection, before, after } of changes) {
    await audit.write({
      kind: "collection-super-admin-access-changed",
      actorKind: "core",
      metadata: {
        collection,
        before: before ? "closed" : "open",
        after: after ? "closed" : "open",
        source: "code",
      },
    });
  }
}
