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
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
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
  ipAddress: string | null;
  userAgent: string | null;
  identityErasedAt: unknown;
  metadata: { marker?: string } | string | null;
}

const ACTOR = { id: "audit-late-write-actor", email: "late@example.test" };

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
