/**
 * The address rule as the migrate commands apply it.
 *
 * `migrate:check` and `migrate:create` read the definitions (configuration and
 * the Builder's manifest) and the latest snapshot, never the database, so the
 * snapshot is what tells a new address from an existing one: an entity whose
 * table the latest snapshot records already exists and keeps its address; any
 * other is new and judged by the one address rule (`shared/address-rule`).
 * With no snapshot the two cannot be told apart, so nothing is refused and
 * every address the rule refuses is only reported: the other roads judged
 * those addresses when they were created.
 *
 * @module domains/schema/migrate-create/addresses
 */

import {
  addressRefusalsError,
  type AddressedEntity,
  type AddressKind,
  type JudgedAddress,
  judgeAddresses,
} from "../../../shared/address-rule";

type Tabled = ReadonlyArray<{ slug: string; tableName: string }>;

/** The latest snapshot, as far as telling a new address from an existing one needs it. */
type LatestSnapshot = {
  data: {
    snapshot: { tables: ReadonlyArray<{ name: string }> };
    entities?: Record<
      "collections" | "singles" | "fieldGroups",
      Readonly<Record<string, unknown>>
    >;
  };
} | null;

const RECORD_KEY = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
} as const;

/**
 * Whether an entity is new against the latest snapshot: one its record of
 * entities does not hold, by kind and address, so a changed address is new
 * even when its table (a kept `dbName`) is in the snapshot. A snapshot written
 * before entities were recorded is read by its tables instead. With no
 * snapshot nothing can be told apart, and nothing is new.
 */
function isNewAgainst(
  latest: LatestSnapshot,
  kind: AddressKind,
  entity: { slug: string; tableName: string }
): boolean {
  if (latest === null) return false;
  const recorded = latest.data.entities;
  if (recorded !== undefined)
    return !(entity.slug in recorded[RECORD_KEY[kind]]);
  return !latest.data.snapshot.tables.some(
    table => table.name === entity.tableName
  );
}

/**
 * Judges the merged entities' addresses against the latest snapshot (`null`
 * when there is none): `refused` for a new address the rule refuses,
 * `existing` for an address an entity already has that it refuses.
 */
export function judgeMigrationAddresses(
  merged: { collections: Tabled; singles: Tabled; components: Tabled },
  latest: LatestSnapshot
): { refused: JudgedAddress[]; existing: JudgedAddress[] } {
  const kinds: Array<[AddressKind, Tabled]> = [
    ["collection", merged.collections],
    ["single", merged.singles],
    ["fieldGroup", merged.components],
  ];
  const entities: AddressedEntity[] = kinds.flatMap(([kind, list]) =>
    list.map(entity => ({
      kind,
      address: entity.slug,
      isNew: isNewAgainst(latest, kind, entity),
    }))
  );
  return judgeAddresses(entities);
}

/** One line per judged address, naming the address and the reason. */
function describeJudgedAddresses(judged: readonly JudgedAddress[]): string[] {
  return judged.map(({ refusal }) => `${refusal.code}: ${refusal.message}`);
}

/**
 * `migrate:create`'s check: logs each new address the rule refuses, naming the
 * address and the reason, and throws before anything is written, so the
 * migrations folder is unchanged by a refusal.
 */
export function assertMigrationAddresses(
  merged: { collections: Tabled; singles: Tabled; components: Tabled },
  latest: LatestSnapshot,
  logger: { error(message: string): void }
): void {
  const { refused } = judgeMigrationAddresses(merged, latest);
  if (refused.length === 0) return;
  for (const line of describeJudgedAddresses(refused)) logger.error(line);
  throw addressRefusalsError(refused);
}

/**
 * `migrate:check`'s check: warns once for each existing address the rule
 * refuses (it keeps working) and logs each new one it refuses, naming the
 * address and the reason. Answers whether the check may pass; with no
 * entities to judge, it may.
 */
export function reportMigrationAddresses(
  merged:
    | { collections: Tabled; singles: Tabled; components: Tabled }
    | undefined,
  latest: LatestSnapshot,
  logger: { warn(message: string): void; error(message: string): void }
): boolean {
  if (merged === undefined) return true;
  const { refused, existing } = judgeMigrationAddresses(merged, latest);
  for (const line of describeJudgedAddresses(existing)) {
    logger.warn(
      `${line}. It already exists, so it keeps working; only a new or changed address is refused.`
    );
  }
  for (const line of describeJudgedAddresses(refused)) logger.error(line);
  return refused.length === 0;
}
