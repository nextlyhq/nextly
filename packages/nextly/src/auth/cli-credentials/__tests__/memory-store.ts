/**
 * A CLI credential store held in memory, for the service's unit tests. It
 * keeps the one property of the database store the service relies on: a
 * rotation moves the row only from the generation it names, and only while
 * the row is not revoked. The database store itself is tested on every
 * dialect in `cli-credentials.integration.test.ts`.
 */
import type { CliCredentialService, VerifiedCliCredential } from "../service";
import type { CliCredentialRow, CliCredentialStore } from "../store";

export interface MemoryCliCredentialStore extends CliCredentialStore {
  rows: Map<string, CliCredentialRow>;
}

export function memoryCliCredentialStore(): MemoryCliCredentialStore {
  const rows = new Map<string, CliCredentialRow>();
  return {
    rows,
    async insert(row) {
      rows.set(row.id, { ...row });
    },
    async find(ids) {
      return ids.flatMap(id => {
        const row = rows.get(id);
        return row ? [{ ...row }] : [];
      });
    },
    async rotate(change) {
      const row = rows.get(change.id);
      if (
        !row ||
        row.refreshGeneration !== change.fromGeneration ||
        row.revokedAt !== null
      ) {
        return false;
      }
      row.refreshTokenHash = change.refreshTokenHash;
      row.refreshGeneration = change.fromGeneration + 1;
      row.lastUsedAt = change.usedAt;
      row.idleEndsAt = change.idleEndsAt;
      return true;
    },
    async revoke(match, at, reason) {
      for (const row of rows.values()) {
        const matches =
          "id" in match ? row.id === match.id : row.familyId === match.familyId;
        if (matches && row.revokedAt === null) {
          row.revokedAt = at;
          row.revokedReason = reason;
        }
      }
    },
  };
}

/**
 * The credential a door accepted for an access token, as a route would hold
 * it before making a pass from it. Throws when the token is refused, so a
 * test never makes a pass from a credential no door accepted.
 */
export async function credentialOf(
  service: CliCredentialService,
  accessToken: string
): Promise<VerifiedCliCredential> {
  const verified = await service.verify(accessToken, "command");
  if (!verified.ok) throw new Error(`token refused: ${verified.reason}`);
  return verified.credential;
}
