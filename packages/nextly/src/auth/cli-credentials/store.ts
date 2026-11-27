/**
 * Where CLI credentials are kept: `nextly_cli_credentials`, through the
 * adapter, the same on every dialect.
 *
 * The service decides; this module only reads and writes rows. Its one
 * subtle write is {@link CliCredentialStore.rotate}, a compare-and-set on
 * the refresh generation: of two renewals presenting the same token, exactly
 * one moves the row, and the other learns it lost. The generation always
 * moves, so the count MySQL reports (changed rows, not matched) is the
 * matched count too.
 *
 * @module auth/cli-credentials/store
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { CLI_CREDENTIALS_TABLE } from "../../schemas/cli-credentials/table-name";

import { isCliCredentialPurpose, type CliCredentialPurpose } from "./purposes";

/** Why a credential was ended before its time. */
export type CliCredentialRevokeReason =
  /** The person signed out, or revoked it from their account. */
  | "revoked"
  /** A refresh token already replaced was presented again. */
  | "refresh-reused";

/** One stored credential. Times are milliseconds since the epoch. */
export interface CliCredentialRow {
  id: string;
  purpose: CliCredentialPurpose;
  userId: string;
  familyId: string;
  parentId: string | null;
  agentName: string | null;
  door: string;
  machine: string | null;
  refreshTokenHash: string | null;
  refreshGeneration: number;
  createdAt: number;
  lastUsedAt: number | null;
  idleEndsAt: number | null;
  endsAt: number;
  revokedAt: number | null;
  revokedReason: string | null;
}

/** A renewal's write: the replacement token's hash, at the next generation. */
export interface CliCredentialRotation {
  id: string;
  /** The generation the presented token was issued at. */
  fromGeneration: number;
  refreshTokenHash: string;
  usedAt: number;
  idleEndsAt: number;
}

/** The reads and writes the credential service makes. */
export interface CliCredentialStore {
  insert(row: CliCredentialRow): Promise<void>;
  /** The rows with these ids that exist, in no particular order. */
  find(ids: readonly string[]): Promise<CliCredentialRow[]>;
  /** A person's credentials not revoked yet, in no particular order. */
  findUnrevokedFor(userId: string): Promise<CliCredentialRow[]>;
  /**
   * Replace the refresh token if the row is still at `fromGeneration` and
   * not revoked. True when this call moved it; false when another renewal
   * got there first or the row was revoked.
   */
  rotate(change: CliCredentialRotation): Promise<boolean>;
  /**
   * End every credential not ended yet that matches: one credential by its
   * id, or a whole family by its sign-in's id.
   */
  revoke(
    match: { id: string } | { familyId: string },
    at: number,
    reason: CliCredentialRevokeReason
  ): Promise<void>;
}

const COLUMNS = [
  "id",
  "purpose",
  "userId",
  "familyId",
  "parentId",
  "agentName",
  "door",
  "machine",
  "refreshTokenHash",
  "refreshGeneration",
  "createdAt",
  "lastUsedAt",
  "idleEndsAt",
  "endsAt",
  "revokedAt",
  "revokedReason",
] as const satisfies readonly (keyof CliCredentialRow)[];

type RawRow = Partial<Record<(typeof COLUMNS)[number], unknown>>;

/** A text column's value, or null when it holds none. */
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * A number column's value, or null when it holds none. Drivers hand back a
 * big integer as a number, a bigint or a numeric string depending on the
 * dialect and its settings; all three read the same.
 */
function time(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "bigint" || typeof value === "string") {
    const read = Number(value);
    return Number.isFinite(read) ? read : null;
  }
  return null;
}

/**
 * A row as the service reads it, or null for one it cannot trust: a purpose
 * that is none of the known ones, or a required value missing. Such a row
 * is never acted on, so it refuses its token rather than guessing.
 */
function rowFrom(raw: RawRow): CliCredentialRow | null {
  const id = text(raw.id);
  const userId = text(raw.userId);
  const familyId = text(raw.familyId);
  const door = text(raw.door);
  const refreshGeneration = time(raw.refreshGeneration);
  const createdAt = time(raw.createdAt);
  const endsAt = time(raw.endsAt);
  if (
    !isCliCredentialPurpose(raw.purpose) ||
    id === null ||
    userId === null ||
    familyId === null ||
    door === null ||
    refreshGeneration === null ||
    createdAt === null ||
    endsAt === null
  ) {
    return null;
  }
  return {
    id,
    purpose: raw.purpose,
    userId,
    familyId,
    parentId: text(raw.parentId),
    agentName: text(raw.agentName),
    door,
    machine: text(raw.machine),
    refreshTokenHash: text(raw.refreshTokenHash),
    refreshGeneration,
    createdAt,
    lastUsedAt: time(raw.lastUsedAt),
    idleEndsAt: time(raw.idleEndsAt),
    endsAt,
    revokedAt: time(raw.revokedAt),
    revokedReason: text(raw.revokedReason),
  };
}

/** The store over a site's database. */
export function cliCredentialStore(
  adapter: DrizzleAdapter
): CliCredentialStore {
  return {
    async insert(row) {
      await adapter.insert(CLI_CREDENTIALS_TABLE, { ...row });
    },

    async find(ids) {
      if (ids.length === 0) return [];
      const rows = await adapter.select<RawRow>(CLI_CREDENTIALS_TABLE, {
        columns: [...COLUMNS],
        where: { and: [{ column: "id", op: "IN", value: [...ids] }] },
      });
      return rows.flatMap(raw => rowFrom(raw) ?? []);
    },

    async findUnrevokedFor(userId) {
      // By the person's index; a person holds a handful of rows, and ended
      // ones are filtered by the service, which owns what "ended" means.
      const rows = await adapter.select<RawRow>(CLI_CREDENTIALS_TABLE, {
        columns: [...COLUMNS],
        where: {
          and: [
            { column: "userId", op: "=", value: userId },
            { column: "revokedAt", op: "IS NULL" },
          ],
        },
      });
      return rows.flatMap(raw => rowFrom(raw) ?? []);
    },

    async rotate(change) {
      const moved = await adapter.updateCount(
        CLI_CREDENTIALS_TABLE,
        {
          refreshTokenHash: change.refreshTokenHash,
          refreshGeneration: change.fromGeneration + 1,
          lastUsedAt: change.usedAt,
          idleEndsAt: change.idleEndsAt,
        },
        {
          and: [
            { column: "id", op: "=", value: change.id },
            {
              column: "refreshGeneration",
              op: "=",
              value: change.fromGeneration,
            },
            { column: "revokedAt", op: "IS NULL" },
          ],
        }
      );
      return moved === 1;
    },

    async revoke(match, at, reason) {
      const key =
        "id" in match
          ? { column: "id", op: "=" as const, value: match.id }
          : { column: "familyId", op: "=" as const, value: match.familyId };
      await adapter.updateCount(
        CLI_CREDENTIALS_TABLE,
        { revokedAt: at, revokedReason: reason },
        { and: [key, { column: "revokedAt", op: "IS NULL" }] }
      );
    },
  };
}
