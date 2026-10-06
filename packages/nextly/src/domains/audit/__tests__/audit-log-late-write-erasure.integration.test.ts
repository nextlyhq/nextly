/**
 * An audit write that lands after its actor's account is gone stores no identity.
 *
 * `audit_log.actor_user_id` carries no foreign key, deliberately, so the trail
 * outlives the account. That is what creates the race: an attributed write
 * resolves its actor, the account is deleted, the deletion's own erasure and its
 * post-commit sweep both run, and only then does the write land. Nothing sweeps
 * again, so an address and a client stored at that point are unreachable by any
 * later erasure — the account they belong to no longer exists to key on.
 *
 * The window is narrow. The consequence is not, which is why this asserts on the
 * ORDER that produces it rather than on a race it would have to win.
 *
 * Runs on every dialect the environment can reach. The writer swallows its own
 * failures, so a botched fix here stops auth logging with nothing but a warning
 * and a single-dialect suite would not notice.
 */
import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { getNextlyLogger } from "../../../observability/logger";
import { buildAuditLogWriter } from "../audit-log-writer";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** An `audit_log` row as read back (Drizzle camelCases the columns). */
interface AuditRow {
  kind: string;
  actorUserId: string | null;
  targetUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  identityErasedAt: unknown;
  metadata: { marker?: string } | string | null;
}

const ACTOR = { id: "audit-late-write-actor", email: "late@example.test" };

/** Run `work`, returning every warning the core logger received meanwhile. */
async function warningsDuring(work: () => Promise<void>): Promise<unknown[]> {
  const warnings: unknown[] = [];
  const logger = getNextlyLogger();
  const originalWarn = logger.warn.bind(logger);
  logger.warn = (payload: unknown) => {
    warnings.push(payload);
    return originalWarn(payload as never);
  };
  try {
    await work();
  } finally {
    logger.warn = originalWarn;
  }
  return warnings;
}

/** The warning a plugin row whose target names no account raises. */
function droppedMetadataWarnings(warnings: unknown[]): unknown[] {
  return warnings.filter(
    w => (w as { kind?: string }).kind === "plugin-audit-metadata-dropped"
  );
}

/** The rows this test wrote — `audit_log` is a fixed, unprefixed system table. */
async function rowsFor(
  handle: TestNextly,
  marker: string
): Promise<AuditRow[]> {
  const all = await handle.adapter.select<AuditRow>("audit_log");
  return all.filter(row => {
    const meta =
      typeof row.metadata === "string"
        ? (JSON.parse(row.metadata) as { marker?: string })
        : row.metadata;
    return meta?.marker === marker;
  });
}

describe.each(getConfiguredTestDialects())(
  "audit-log identity on a late write (%s)",
  dialect => {
    it("keeps the address and client while the account exists", async () => {
      // The control. Asserting only the erased case would pass just as well if
      // the writer had stopped storing identifiers altogether.
      current = await createTestNextly({ dialect });
      await current.adapter.insert("users", {
        id: ACTOR.id,
        email: ACTOR.email,
        is_active: true,
      });
      const marker = `present-${dialect}-${Date.now()}`;

      await buildAuditLogWriter((name: string) =>
        current!.getService(name as Parameters<TestNextly["getService"]>[0])
      ).write({
        kind: "login-succeeded",
        actorUserId: ACTOR.id,
        ipAddress: "203.0.113.7",
        userAgent: "probe/1.0",
        metadata: { marker },
      });

      const [row] = await rowsFor(current, marker);
      expect(row).toBeDefined();
      expect(row.ipAddress).toBe("203.0.113.7");
      expect(row.userAgent).toBe("probe/1.0");
      expect(row.identityErasedAt).toBeFalsy();
    });

    it("stores no address or client once the account is gone", async () => {
      // The account is deleted BEFORE the write lands: the deletion's erasure
      // and its post-commit sweep have both already run, so nothing will ever
      // revisit this row. The identity has to be refused as it is written.
      current = await createTestNextly({ dialect });
      const marker = `erased-${dialect}-${Date.now()}`;

      await buildAuditLogWriter((name: string) =>
        current!.getService(name as Parameters<TestNextly["getService"]>[0])
      ).write({
        kind: "login-succeeded",
        actorUserId: "audit-late-write-deleted-actor",
        ipAddress: "203.0.113.9",
        userAgent: "probe/2.0",
        metadata: { marker },
      });

      const [row] = await rowsFor(current, marker);
      expect(row).toBeDefined();
      // The FACT survives — who it was attributed to, and that it happened.
      expect(row.actorUserId).toBe("audit-late-write-deleted-actor");
      expect(row.kind).toBe("login-succeeded");
      // The person does not.
      expect(row.ipAddress).toBeNull();
      expect(row.userAgent).toBeNull();
      // "Erased" and "never carried one" are different facts; only the stamp
      // answers which this row is.
      expect(row.identityErasedAt).toBeTruthy();
    });

    it("stores no plugin metadata once the account is gone", async () => {
      // A plugin's metadata is what the plugin chose to keep — an email, a
      // provider subject — so a write racing the deletion must not put it
      // back. Found by its actor, since the metadata is what is cleared.
      current = await createTestNextly({ dialect });
      const actor = `plugin-late-write-${dialect}-${Date.now()}`;

      await buildAuditLogWriter((name: string) =>
        current!.getService(name as Parameters<TestNextly["getService"]>[0])
      ).write({
        kind: "acme-auth.identity-linked" as never,
        actorUserId: actor,
        metadata: { email: "gone@example.test" },
      });

      const rows = (await current.adapter.select<AuditRow>("audit_log")).filter(
        row => row.actorUserId === actor
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toBeNull();
      expect(rows[0].identityErasedAt).toBeTruthy();
    });

    it("keeps a plugin's metadata while the account exists", async () => {
      // The control for the case above.
      current = await createTestNextly({ dialect });
      await current.adapter.insert("users", {
        id: ACTOR.id,
        email: ACTOR.email,
        is_active: true,
      });
      const marker = `plugin-present-${dialect}-${Date.now()}`;

      await buildAuditLogWriter((name: string) =>
        current!.getService(name as Parameters<TestNextly["getService"]>[0])
      ).write({
        kind: "acme-auth.identity-linked" as never,
        actorUserId: ACTOR.id,
        metadata: { marker },
      });

      expect(await rowsFor(current, marker)).toHaveLength(1);
    });

    it.each([
      ["no actor", null],
      ["a live actor", ACTOR.id],
    ])(
      "stores no plugin metadata once the TARGET is gone, with %s",
      async (_, actorUserId) => {
        // An SSO plugin unlinking a deleted user's identity names them as the
        // target, and its metadata — an email, a provider subject — is theirs.
        // Deletion clears such a row's metadata, so a write landing after the
        // deletion's sweep must not store it.
        current = await createTestNextly({ dialect });
        await current.adapter.insert("users", {
          id: ACTOR.id,
          email: ACTOR.email,
          is_active: true,
        });
        const target = `plugin-late-target-${dialect}-${Date.now()}`;

        const warnings = await warningsDuring(() =>
          buildAuditLogWriter((name: string) =>
            current!.getService(name as Parameters<TestNextly["getService"]>[0])
          ).write({
            kind: "acme-sso.identity-unlinked" as never,
            actorUserId,
            targetUserId: target,
            ipAddress: "203.0.113.21",
            metadata: { email: "gone@example.test" },
          })
        );

        // A target that was deleted and one that is not a user id at all look
        // the same, so the operator is told which row lost its metadata —
        // without the metadata, which stays out of the log as it stays out of
        // the row, and without the target, which may be just as personal.
        expect(droppedMetadataWarnings(warnings)).toEqual([
          {
            kind: "plugin-audit-metadata-dropped",
            eventKind: "acme-sso.identity-unlinked",
            reason: "target-account-absent",
            targetLength: target.length,
            targetIsUserIdShaped: false,
          },
        ]);
        expect(JSON.stringify(warnings)).not.toContain("gone@example.test");
        expect(JSON.stringify(warnings)).not.toContain(target);

        const rows = (
          await current.adapter.select<AuditRow>("audit_log")
        ).filter(row => row.targetUserId === target);
        expect(rows).toHaveLength(1);
        expect(rows[0].metadata).toBeNull();
        // The address is the actor's, and the actor, if any, still exists.
        expect(rows[0].ipAddress).toBe("203.0.113.21");
        expect(rows[0].identityErasedAt).toBeFalsy();
      }
    );

    it("says a missing target had a user id's shape, still without naming it", async () => {
      // The other half of what the warning tells the operator: a deleted
      // account's id has a user id's shape, an email or provider subject does
      // not. A warning that always said "not shaped" would pass the case above.
      current = await createTestNextly({ dialect });
      const target = randomUUID();

      const warnings = await warningsDuring(() =>
        buildAuditLogWriter((name: string) =>
          current!.getService(name as Parameters<TestNextly["getService"]>[0])
        ).write({
          kind: "acme-sso.identity-unlinked" as never,
          targetUserId: target,
          metadata: { email: "gone@example.test" },
        })
      );

      expect(droppedMetadataWarnings(warnings)).toEqual([
        {
          kind: "plugin-audit-metadata-dropped",
          eventKind: "acme-sso.identity-unlinked",
          reason: "target-account-absent",
          targetLength: 36,
          targetIsUserIdShaped: true,
        },
      ]);
      expect(JSON.stringify(warnings)).not.toContain(target);
    });

    it("keeps a plugin's metadata while its target exists", async () => {
      // The control for the case above, on the path that had no decision at
      // all: no actor.
      current = await createTestNextly({ dialect });
      await current.adapter.insert("users", {
        id: ACTOR.id,
        email: ACTOR.email,
        is_active: true,
      });
      const marker = `plugin-target-present-${dialect}-${Date.now()}`;

      const warnings = await warningsDuring(() =>
        buildAuditLogWriter((name: string) =>
          current!.getService(name as Parameters<TestNextly["getService"]>[0])
        ).write({
          kind: "acme-sso.identity-unlinked" as never,
          targetUserId: ACTOR.id,
          metadata: { marker },
        })
      );

      expect(await rowsFor(current, marker)).toHaveLength(1);
      // And no warning: one raised for every plugin row with a target would
      // pass the case above while telling the operator nothing.
      expect(droppedMetadataWarnings(warnings)).toEqual([]);
    });

    it("stores an unattributed event as it is, with no erasure stamp", async () => {
      // A failed sign-in for an address that owns no account names nobody, so
      // there is nothing to erase against. Stamping it would claim a person was
      // removed from a row that never held one.
      current = await createTestNextly({ dialect });
      const marker = `anon-${dialect}-${Date.now()}`;

      await buildAuditLogWriter((name: string) =>
        current!.getService(name as Parameters<TestNextly["getService"]>[0])
      ).write({
        kind: "login-failed",
        ipAddress: "203.0.113.11",
        userAgent: "probe/3.0",
        metadata: { marker },
      });

      const [row] = await rowsFor(current, marker);
      expect(row).toBeDefined();
      expect(row.actorUserId).toBeNull();
      expect(row.ipAddress).toBe("203.0.113.11");
      expect(row.identityErasedAt).toBeFalsy();
    });
  }
);
