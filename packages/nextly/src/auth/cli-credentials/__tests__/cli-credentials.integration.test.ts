/**
 * CLI credentials in a real database, on every dialect: a renewal replaces
 * the stored refresh token, a replayed one revokes the sign-in and every
 * credential issued from it, two renewals of one token at once leave exactly
 * one winner, and the stored rows hold hashes only, never a token.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import {
  updateUserEndingSessions,
  type PasswordWriteTx,
} from "../../../domains/users/services/password-write";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CLI_CREDENTIALS_TABLE } from "../../../schemas/cli-credentials";
import { hashRefreshToken, parseRefreshToken } from "../refresh-token";
import {
  createCliCredentialService,
  type CliCredentialService,
} from "../service";
import { cliCredentialStore, type CliCredentialRow } from "../store";

import { credentialOf, signedIn } from "./memory-store";

const SECRET = "an-integration-secret-of-plenty-of-characters";
const PERSON = { id: "cli-credentials-person", email: "cli@example.com" };

/** The Drizzle handle's own transaction, as core's services open theirs. */
interface Transactor {
  transaction<T>(work: (tx: PasswordWriteTx) => Promise<T>): Promise<T>;
}

describeEachDialect("CLI credentials", dialect => {
  let current: TestNextly;
  let service: CliCredentialService;

  /** Every stored row, every column, as the adapter reads it. */
  const storedRows = async () =>
    current.adapter.select<Record<string, unknown>>(CLI_CREDENTIALS_TABLE, {});
  const storedRow = async (id: string) =>
    (await storedRows()).find(row => row.id === id) as
      | (Record<string, unknown> & Partial<CliCredentialRow>)
      | undefined;

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    await current.adapter.insert("users", {
      id: PERSON.id,
      email: PERSON.email,
      is_active: true,
    });
    service = createCliCredentialService({
      store: cliCredentialStore(current.adapter),
      secret: SECRET,
    });
  });
  afterAll(async () => {
    await current?.destroy();
  });
  beforeEach(async () => {
    await current.adapter.delete(CLI_CREDENTIALS_TABLE, {
      and: [{ column: "userId", op: "=", value: PERSON.id }],
    });
  });

  describe("a renewal", () => {
    it("replaces the stored refresh token and issues an access token the door accepts", async () => {
      const signIn = await signedIn(service, {
        userId: PERSON.id,
        machine: "laptop",
      });
      const before = await storedRow(signIn.credentialId);
      expect(before?.refreshTokenHash).toBe(
        hashRefreshToken(signIn.refreshToken)
      );
      expect(Number(before?.refreshGeneration)).toBe(0);

      const renewed = await service.renew(signIn.refreshToken);
      if (!renewed.ok) throw new Error(`renewal refused: ${renewed.reason}`);

      const after = await storedRow(signIn.credentialId);
      expect(after?.refreshTokenHash).toBe(
        hashRefreshToken(renewed.refreshToken)
      );
      expect(Number(after?.refreshGeneration)).toBe(1);
      expect(Number(after?.lastUsedAt)).toBeGreaterThanOrEqual(
        Number(before?.lastUsedAt)
      );
      expect(Number(after?.endsAt)).toBe(Number(before?.endsAt));
      expect(
        await service.verify(renewed.accessToken, "command")
      ).toMatchObject({
        ok: true,
        credential: { credentialId: signIn.credentialId, userId: PERSON.id },
      });
      expect((await service.renew(renewed.refreshToken)).ok).toBe(true);
    });

    it("of one token presented twice at once, succeeds once and revokes the sign-in", async () => {
      const signIn = await signedIn(service, {
        userId: PERSON.id,
        machine: null,
      });

      const results = await Promise.all([
        service.renew(signIn.refreshToken),
        service.renew(signIn.refreshToken),
      ]);

      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.filter(result => !result.ok)).toEqual([
        { ok: false, reason: "reused" },
      ]);
      expect((await storedRow(signIn.credentialId))?.revokedReason).toBe(
        "refresh-reused"
      );
    });
  });

  describe("a renewal racing a sign-out", () => {
    it("does not replace the token of a sign-in revoked after it was read", async () => {
      const store = cliCredentialStore(current.adapter);
      // The sign-out lands between the renewal's read and its write: the
      // store's own write must refuse to move a revoked row.
      const racing = {
        ...store,
        rotate: async (change: Parameters<typeof store.rotate>[0]) => {
          await store.revoke({ familyId: change.id }, Date.now(), "revoked");
          return store.rotate(change);
        },
      };
      const racingService = createCliCredentialService({
        store: racing,
        secret: SECRET,
      });
      const signIn = await signedIn(racingService, {
        userId: PERSON.id,
        machine: null,
      });

      expect(await racingService.renew(signIn.refreshToken)).toEqual({
        ok: false,
        reason: "revoked",
      });
      const row = await storedRow(signIn.credentialId);
      expect(Number(row?.refreshGeneration)).toBe(0);
      expect(row?.refreshTokenHash).toBe(hashRefreshToken(signIn.refreshToken));
      expect(row?.revokedReason).toBe("revoked");
    });
  });

  describe("a replayed refresh token", () => {
    it("revokes the sign-in and every credential issued from it", async () => {
      const signIn = await signedIn(service, {
        userId: PERSON.id,
        machine: null,
      });
      const pass = await service.issueAgentPass({
        from: await credentialOf(service, signIn.accessToken),
        agentName: "Claude Code",
        machine: null,
      });
      if (!pass.ok) throw new Error(`pass refused: ${pass.reason}`);
      // Another sign-in of the same person: not of this family, so it stays.
      const other = await signedIn(service, {
        userId: PERSON.id,
        machine: null,
      });
      const renewed = await service.renew(signIn.refreshToken);
      if (!renewed.ok) throw new Error(`renewal refused: ${renewed.reason}`);

      expect(await service.renew(signIn.refreshToken)).toEqual({
        ok: false,
        reason: "reused",
      });

      for (const id of [signIn.credentialId, pass.credentialId]) {
        const row = await storedRow(id);
        expect(row?.revokedReason).toBe("refresh-reused");
        expect(row?.revokedAt).not.toBeNull();
      }
      expect((await storedRow(other.credentialId))?.revokedAt).toBeNull();
      expect(await service.renew(renewed.refreshToken)).toEqual({
        ok: false,
        reason: "revoked",
      });
      for (const token of [renewed.accessToken, pass.accessToken]) {
        expect(await service.verify(token, "command")).toEqual({
          ok: false,
          reason: "revoked",
        });
      }
      expect((await service.verify(other.accessToken, "command")).ok).toBe(
        true
      );
    });
  });

  describe("a person's list", () => {
    it("holds their standing credentials and nothing revoked or another person's", async () => {
      const other = { id: `${PERSON.id}-other`, email: "other@example.com" };
      await current.adapter.insert("users", {
        id: other.id,
        email: other.email,
        is_active: true,
      });
      const signIn = await signedIn(service, {
        userId: PERSON.id,
        machine: "laptop",
      });
      const pass = await service.issueAgentPass({
        from: await credentialOf(service, signIn.accessToken),
        agentName: "Claude Code",
        machine: "laptop",
      });
      if (!pass.ok) throw new Error(`pass refused: ${pass.reason}`);
      const revoked = await signedIn(service, {
        userId: PERSON.id,
        machine: "old",
      });
      await service.revoke(
        { credentialId: revoked.credentialId, userId: PERSON.id },
        "revoked"
      );
      const theirs = await signedIn(service, {
        userId: other.id,
        machine: null,
      });

      const listed = await service.listFor(PERSON.id);

      expect(listed.map(held => held.credentialId).sort()).toEqual(
        [signIn.credentialId, pass.credentialId].sort()
      );
      expect(
        (await service.listFor(other.id)).map(held => held.credentialId)
      ).toEqual([theirs.credentialId]);
      await current.adapter.delete(CLI_CREDENTIALS_TABLE, {
        and: [{ column: "userId", op: "=", value: other.id }],
      });
      await current.adapter.delete("users", {
        and: [{ column: "id", op: "=", value: other.id }],
      });
    });
  });

  describe("a person whose sessions are ended", () => {
    /**
     * The write core makes for a new password or a deactivation, in a
     * transaction opened as the user service opens it: on SQLite, whose
     * driver takes no async Drizzle transaction, the adapter's own over the
     * shared handle.
     */
    const endSessions = async (
      userId: string,
      set: { passwordHash: string } | { isActive: false; deactivatedAt: Date }
    ) => {
      const write = (tx: PasswordWriteTx) =>
        updateUserEndingSessions(tx, getDialectTables(dialect), dialect, {
          userId,
          set,
          adapter: current.adapter,
        });
      if (dialect === "sqlite") {
        await current.adapter.transaction(() =>
          write(current.adapter.getDrizzle() as unknown as PasswordWriteTx)
        );
        return;
      }
      const db = current.adapter.getDrizzle() as unknown as Transactor;
      await db.transaction(write);
    };

    it("loses every CLI credential made before a new password, and no one else does", async () => {
      const other = { id: `${PERSON.id}-reset-other`, email: "ro@example.com" };
      await current.adapter.insert("users", {
        id: other.id,
        email: other.email,
        is_active: true,
      });
      const signIn = await signedIn(service, {
        userId: PERSON.id,
        machine: null,
      });
      const pass = await service.issueAgentPass({
        from: await credentialOf(service, signIn.accessToken),
        agentName: null,
        machine: null,
      });
      if (!pass.ok) throw new Error(`pass refused: ${pass.reason}`);
      const theirs = await signedIn(service, {
        userId: other.id,
        machine: null,
      });

      await endSessions(PERSON.id, { passwordHash: "a-new-password-hash" });

      for (const token of [signIn.accessToken, pass.accessToken]) {
        expect(await service.verify(token, "command")).toEqual({
          ok: false,
          reason: "account",
        });
      }
      expect(await service.renew(signIn.refreshToken)).toEqual({
        ok: false,
        reason: "account",
      });
      for (const id of [signIn.credentialId, pass.credentialId]) {
        expect((await storedRow(id))?.revokedReason).toBe("account-ended");
      }
      expect((await service.verify(theirs.accessToken, "command")).ok).toBe(
        true
      );
      expect((await service.renew(theirs.refreshToken)).ok).toBe(true);
      const fresh = await signedIn(service, {
        userId: PERSON.id,
        machine: null,
      });
      expect((await service.verify(fresh.accessToken, "command")).ok).toBe(
        true
      );

      await current.adapter.delete(CLI_CREDENTIALS_TABLE, {
        and: [{ column: "userId", op: "=", value: other.id }],
      });
      await current.adapter.delete("users", {
        and: [{ column: "id", op: "=", value: other.id }],
      });
    });

    it("deactivated and reactivated, gets none of the earlier ones back", async () => {
      const signIn = await signedIn(service, {
        userId: PERSON.id,
        machine: null,
      });

      await endSessions(PERSON.id, {
        isActive: false,
        deactivatedAt: new Date(),
      });
      expect(await service.verify(signIn.accessToken, "command")).toEqual({
        ok: false,
        reason: "account",
      });
      expect(
        await service.signIn({ userId: PERSON.id, machine: null })
      ).toEqual({ ok: false, reason: "account" });

      // Reactivated the way an administrator does: the account is active
      // again, and its epoch stays where the deactivation left it.
      await current.adapter.update(
        "users",
        { is_active: true, deactivated_at: null },
        { and: [{ column: "id", op: "=", value: PERSON.id }] }
      );
      expect(await service.verify(signIn.accessToken, "command")).toEqual({
        ok: false,
        reason: "account",
      });
      expect(await service.renew(signIn.refreshToken)).toEqual({
        ok: false,
        reason: "account",
      });
      const fresh = await signedIn(service, {
        userId: PERSON.id,
        machine: null,
      });
      expect((await service.verify(fresh.accessToken, "command")).ok).toBe(
        true
      );
    });
  });

  describe("the stored rows", () => {
    it("hold only a hash of the refresh token, and nothing of any token", async () => {
      const signIn = await signedIn(service, {
        userId: PERSON.id,
        machine: "laptop",
      });
      const renewed = await service.renew(signIn.refreshToken);
      if (!renewed.ok) throw new Error(`renewal refused: ${renewed.reason}`);
      const pass = await service.issueAgentPass({
        from: await credentialOf(service, signIn.accessToken),
        agentName: "Claude Code",
        machine: "laptop",
      });
      if (!pass.ok) throw new Error(`pass refused: ${pass.reason}`);

      const rows = await storedRows();
      expect(rows).toHaveLength(2);
      // Every secret part of every token issued, and each token whole.
      const secrets = [
        signIn.refreshToken,
        renewed.refreshToken,
        signIn.accessToken,
        renewed.accessToken,
        pass.accessToken,
        ...[signIn.refreshToken, renewed.refreshToken].flatMap(token => {
          const parsed = parseRefreshToken(token);
          return parsed ? [parsed.random, parsed.tag] : [];
        }),
        ...[signIn.accessToken, renewed.accessToken, pass.accessToken].map(
          token => token.split(".")[2]
        ),
      ];
      expect(secrets.every(secret => secret.length >= 32)).toBe(true);
      for (const row of rows) {
        for (const value of Object.values(row)) {
          for (const secret of secrets) {
            expect(String(value)).not.toContain(secret);
          }
        }
      }

      const signInRow = rows.find(row => row.id === signIn.credentialId);
      expect(signInRow).toMatchObject({
        purpose: "cli-sign-in",
        door: "command",
        familyId: signIn.credentialId,
        refreshTokenHash: hashRefreshToken(renewed.refreshToken),
      });
      expect(String(signInRow?.refreshTokenHash)).toMatch(/^[0-9a-f]{64}$/);
      const passRow = rows.find(row => row.id === pass.credentialId);
      expect(passRow).toMatchObject({
        purpose: "agent-pass",
        door: "command",
        familyId: signIn.credentialId,
        parentId: signIn.credentialId,
        agentName: "Claude Code",
        refreshTokenHash: null,
      });
    });
  });
});
