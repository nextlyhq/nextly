/**
 * System health's source: what the System health card answers, and the
 * "System problems" kind of the attention digest, both from one read.
 *
 * ## It combines domain reads and owns no rule
 *
 * - **Version:** the running core version (`getCoreVersion`).
 * - **Migrations:** the boot migrations gate's own state, read without waiting
 *   on it (`assertBootMigrationsSettled`): still running at boot, or refused;
 *   and the schema ledger's migrations with an attempt, an apply's or a
 *   rollback's, that did not finish and that nothing has resolved since
 *   (`readSchemaProblems`, by each migration's standing, as `migrate:status`
 *   reads it).
 * - **Schema changes:** the ledger's collections whose newest schema change
 *   failed or was interrupted, from the same read.
 * - **Storage:** the storage layer's last failed write, which it keeps per
 *   process (`lastStorageWriteFailure`).
 *
 * None of these is computed here a second way: the card and the attention
 * items are two views of {@link readSystemHealth}, so they cannot disagree
 * about what is wrong.
 *
 * ## Only a super-admin is answered
 *
 * Every answer is the install's, not the reader's, so who may see it is the
 * one question: a super-admin, by the one decision (`callerIsSuperAdmin`),
 * asked before anything is read. Anyone else gets no card (the audience never
 * hands it) and no attention item (the kind is hidden, as an absent one is).
 *
 * @module services/dashboard/system-health-source
 */

import {
  callerIsSuperAdmin,
  readAccessCaller,
} from "../../auth/entity-read-access";
import { container } from "../../di/container";
import { readSchemaProblems } from "../../domains/schema/events/schema-problems";
import type { DigestReader } from "../../domains/widgets/attention/digest";
import {
  provideSystemHealth,
  type SystemHealthData,
  type SystemHealthMigrationStatus,
} from "../../domains/widgets/core-widgets/system-health";
import { boundCaller } from "../../domains/widgets/declaration/read-services";
import { NextlyError } from "../../errors/nextly-error";
import { assertBootMigrationsSettled } from "../../init/boot-migrations-gate";
import { getCoreVersion } from "../../plugins/core-version";
import { lastStorageWriteFailure } from "../../storage/last-write-failure";

import type { ReadCaller } from "./readable-resources";

/** How many failed collections the card names; past it, it says how many more. */
const SYSTEM_HEALTH_LISTED_COLLECTIONS = 3;

/** The boot migrations gate's state, read without waiting on it. */
type BootGateState = "settled" | "pending" | "refused";

/**
 * The gate's state, by what it answers a caller that cannot wait: nothing
 * once settled, its pending refusal while boot migrations run, and the
 * process's refusal once refused.
 */
function bootGateState(): BootGateState {
  try {
    assertBootMigrationsSettled();
    return "settled";
  } catch (error) {
    return error instanceof NextlyError &&
      error.code === "NEXTLY_BOOT_MIGRATIONS_PENDING"
      ? "pending"
      : "refused";
  }
}

/** The handle the ledger is read through. */
interface AdapterLike {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
}

/** The registry the failed collections' labels are read from. */
interface CollectionLabels {
  getCollectionBySlug(
    slug: string
  ): Promise<{ labels?: { plural?: string } } | null>;
}

/** A collection's plural label, or its slug when the registry has no row for it. */
async function collectionLabel(slug: string): Promise<string> {
  const registry = container.get<CollectionLabels>("collectionRegistryService");
  const collection = await registry.getCollectionBySlug(slug);
  const label = collection?.labels?.plural;
  return typeof label === "string" && label !== "" ? label : slug;
}

/**
 * The migrations line: failed when the gate refused or a migration has an
 * unresolved attempt (an apply or a rollback that did not finish); pending
 * while boot migrations are still running; otherwise up to date.
 *
 * While the gate is pending, an attempt with no outcome yet is the boot's own
 * run under way, so it is counted as pending; once settled, the same row is an
 * attempt that stopped without one, which the ledger's rule reads as the
 * failure it may be.
 */
function migrationsLine(
  gate: BootGateState,
  unfinished: number
): SystemHealthData["migrations"] {
  if (gate === "pending") {
    return { status: "pending", failed: 0, pending: unfinished };
  }
  const failed = unfinished + (gate === "refused" && unfinished === 0 ? 1 : 0);
  const status: SystemHealthMigrationStatus = failed > 0 ? "failed" : "ok";
  return { status, failed, pending: 0 };
}

/** The storage line: working, or when, where and why its last write failed. */
function storageLine(): SystemHealthData["storage"] {
  const failure = lastStorageWriteFailure();
  return failure === undefined
    ? { status: "ok" }
    : {
        status: "failed",
        failedAt: failure.at,
        adapter: failure.adapter,
        reason: failure.reason,
      };
}

/**
 * The install's health, as System health draws it and the attention kind
 * counts it. Takes no caller: who may see it is decided before it is asked.
 */
async function readSystemHealth(): Promise<SystemHealthData> {
  const adapter = container.get<AdapterLike>("adapter");
  const gate = bootGateState();
  const problems = await readSchemaProblems({
    db: adapter.getDrizzle(),
    dialect: adapter.dialect,
  });
  const failed = problems.failedCollectionChanges;
  const listed = failed.slice(0, SYSTEM_HEALTH_LISTED_COLLECTIONS);
  return {
    version: getCoreVersion(),
    migrations: migrationsLine(gate, problems.unfinishedMigrations.length),
    schemaChanges: {
      failed: await Promise.all(
        listed.map(async slug => ({ slug, label: await collectionLabel(slug) }))
      ),
      more: failed.length - listed.length,
    },
    storage: storageLine(),
  };
}

/** Whether `caller` may be shown the install's health: a super-admin, by the one decision. */
function maySeeSystemHealth(caller: ReadCaller): Promise<boolean> {
  return callerIsSuperAdmin(readAccessCaller(caller));
}

/**
 * The "System problems" kind: one item per problem System health reports,
 * each critical, each with why it matters and where to go about it.
 *
 * A migration has no page in the admin, and the System health card may not
 * be placed, so a migration's item links nowhere: its reason names the
 * command that says which migrations, and what to do about them.
 */
const SYSTEM_PROBLEMS: readonly {
  id: string;
  label: string;
  reason: string;
  link?: string;
  count: (health: SystemHealthData) => number;
}[] = [
  {
    id: "core/system-migrations-failed",
    label: "Failed migrations",
    reason:
      "A migration did not finish applying or rolling back. Run nextly migrate:status to see which.",
    count: health => health.migrations.failed,
  },
  {
    id: "core/system-migrations-pending",
    label: "Pending migrations",
    reason:
      "Migrations are still being applied. Run nextly migrate:status to see which.",
    // Pending with no attempt recorded yet is still one thing waiting.
    count: health =>
      health.migrations.status === "pending"
        ? Math.max(1, health.migrations.pending)
        : 0,
  },
  {
    id: "core/system-schema-changes",
    label: "Failed schema changes",
    reason: "A collection's last schema change failed or did not finish.",
    link: "builder/collections",
    count: health =>
      health.schemaChanges.failed.length + health.schemaChanges.more,
  },
  {
    id: "core/system-storage",
    label: "Failed storage write",
    reason: "The storage adapter's last write failed.",
    link: "media",
    count: health => (health.storage.status === "failed" ? 1 : 0),
  },
];

/**
 * A reader for each system problem, for the attention digest. A reader who is
 * not a super-admin is shown none, as on an install with nothing wrong; so is
 * one whose roles could not be read, since `callerIsSuperAdmin` fails closed.
 * The health is read once for all of them, and only after the caller is known
 * to be a super-admin: each item's own budget bounds it, and a read that fails
 * fails these items alone.
 */
export function systemProblemReaders(caller: ReadCaller): DigestReader[] {
  let allowed: Promise<boolean> | undefined;
  const visible = () => (allowed ??= maySeeSystemHealth(caller));
  let health: Promise<SystemHealthData> | undefined;
  const read = () => (health ??= readSystemHealth());
  return SYSTEM_PROBLEMS.map(problem => ({
    id: problem.id,
    kind: "system" as const,
    label: problem.label,
    reason: problem.reason,
    severity: "critical" as const,
    ...(problem.link === undefined ? {} : { link: problem.link }),
    owner: "core",
    visible,
    read: async () => problem.count(await read()),
  }));
}

/**
 * Hand the System health card its read: as the caller its read services were
 * bound for, refused before anything is read unless that caller is a
 * super-admin.
 */
export function registerSystemHealthSource(): void {
  provideSystemHealth(async services => {
    const caller = boundCaller(services);
    if (!(await maySeeSystemHealth(caller))) {
      throw NextlyError.forbidden({
        logContext: { reason: "system-health-super-admin-required" },
      });
    }
    return readSystemHealth();
  });
}
