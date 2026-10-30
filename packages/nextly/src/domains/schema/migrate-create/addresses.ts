/**
 * The address rule as the migrate commands apply it.
 *
 * `migrate:check` and `migrate:create` read the definitions (configuration and
 * the Builder's manifest) and the latest snapshot, never the database, so the
 * snapshot is what tells a new address from an existing one: an entity the
 * latest snapshot records (by kind and address, or by its table in a snapshot
 * written before entities were recorded) already exists and keeps its address;
 * any other is new and judged by the one address rule (`shared/address-rule`).
 * With no snapshot nothing is known to exist, so everything is new, as on a
 * fresh project.
 *
 * @module domains/schema/migrate-create/addresses
 */

import {
  addressRefusalsError,
  type AddressedEntity,
  type AddressKind,
  type JudgedAddress,
  judgeAddresses,
  type UsedAddress,
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
 * snapshot nothing is known to exist (these commands read files, never the
 * database), so everything is new.
 */
function isNewAgainst(
  latest: LatestSnapshot,
  kind: AddressKind,
  entity: { slug: string; tableName: string }
): boolean {
  if (latest === null) return true;
  const recorded = latest.data.entities;
  if (recorded !== undefined)
    return !(entity.slug in recorded[RECORD_KEY[kind]]);
  return !latest.data.snapshot.tables.some(
    table => table.name === entity.tableName
  );
}

/**
 * The addresses the latest snapshot records that the configuration no longer
 * declares. Their entities keep their registry rows at the next start, which
 * counts them as used, so these commands count them as used too: a new address
 * sharing one's snake_case form is refused here as the start would refuse it.
 */
function removedButStillUsed(
  latest: LatestSnapshot,
  declared: ReadonlyArray<{ kind: AddressKind; address: string }>
): UsedAddress[] {
  const recorded = latest?.data.entities;
  if (recorded === undefined) return [];
  const isDeclared = new Set(declared.map(e => `${e.kind}:${e.address}`));
  return (Object.keys(RECORD_KEY) as AddressKind[]).flatMap(kind =>
    Object.keys(recorded[RECORD_KEY[kind]])
      .filter(address => !isDeclared.has(`${kind}:${address}`))
      .map(address => ({ kind, address }))
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
  return judgeAddresses(entities, removedButStillUsed(latest, entities));
}

/**
 * What to do about a new address the rule refuses, said once after the
 * refusals. An entity a database already holds under it (made before the
 * rule, or only by a development push before the first migration) cannot be
 * told apart from a new one here, since these commands read no database.
 */
const REFUSED_ADDRESS_NEXT_STEP =
  "Give each refused address one the rule accepts. If an entity already exists under it (made before this rule, or only by a development push), remove it from the configuration, create and apply the migration, then add it back under an accepted address.";

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
  if (refused.length > 0) logger.error(REFUSED_ADDRESS_NEXT_STEP);
  throw addressRefusalsError(refused);
}

/**
 * `migrate:check`'s check: warns once for each existing address the rule
 * refuses (it keeps working) and logs each new one it refuses, naming the
 * address and the reason. Answers the new addresses it refused, for the
 * command to end with `addressRefusalsError`; none, with no entities to judge.
 */
export function reportMigrationAddresses(
  merged:
    | { collections: Tabled; singles: Tabled; components: Tabled }
    | undefined,
  latest: LatestSnapshot,
  logger: { warn(message: string): void; error(message: string): void }
): readonly JudgedAddress[] {
  if (merged === undefined) return [];
  const { refused, existing } = judgeMigrationAddresses(merged, latest);
  for (const line of describeJudgedAddresses(existing)) {
    logger.warn(
      `${line}. It already exists, so it keeps working; only a new or changed address is refused.`
    );
  }
  for (const line of describeJudgedAddresses(refused)) logger.error(line);
  if (refused.length > 0) logger.error(REFUSED_ADDRESS_NEXT_STEP);
  return refused;
}
