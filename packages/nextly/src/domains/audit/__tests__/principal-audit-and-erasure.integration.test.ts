/**
 * Audit rows naming a plugin-defined person, and erasure when the plugin
 * reports the person deleted, on every configured dialect.
 *
 * A row names a person by kind and id in columns of its own, and keeps its
 * address, client and metadata while the person exists. Once the plugin
 * reports them deleted, their rows lose those and name them by a keyed digest
 * in place of the id, a row written for them afterwards is written that way
 * already, and nothing anywhere keeps the id. Staff rows, a staff user sharing
 * the person's id among them, stay as they were.
 *
 * @module domains/audit/__tests__/principal-audit-and-erasure.integration.test
 */

// Read by the plugin's audit and report paths through the env proxy: set
// before any of them is imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { runAsPrincipal } from "../../../auth/principal-scope";
import { actorForWrite } from "../../../auth/request-actor";
import { getDialectTables } from "../../../database/index";
import { seedPermissions } from "../../../database/seeders/permissions";
import { seedSuperAdmin } from "../../../database/seeders/super-admin";
import type {
  PluginContext,
  PluginDefinition,
} from "../../../plugins/plugin-context";
import type { PrincipalRef } from "../../../plugins/principals/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildAuditLogWriter, type AuditEvent } from "../audit-log-writer";
import {
  reportPrincipalDeleted,
  resealPrincipalDigestKeyAtBoot,
} from "../erase-principal";

const KIND = "accounts:account";

/** An `audit_log` row as read back (Drizzle camelCases the columns). */
interface AuditRow {
  id: string;
  kind: string;
  actorKind: string | null;
  actorUserId: string | null;
  targetUserId: string | null;
  actorPrincipalKind: string | null;
  actorPrincipalId: string | null;
  targetPrincipalKind: string | null;
  targetPrincipalId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  identityErasedAt: unknown;
  metadata: Record<string, unknown> | string | null;
}

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ctx = undefined;
});

const accounts = {
  name: "accounts",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      {
        name: "account",
        attributes: { verified: "boolean" },
        resolve: async () => null,
        lookup: async (id: string) => ({ id, attributes: { verified: true } }),
      },
    ],
    audit: {
      kinds: [
        { kind: "accounts.signed-in", metadataKeys: ["marker", "method"] },
        { kind: "accounts.changed", metadataKeys: ["marker", "field"] },
      ],
    },
  },
  init(context: PluginContext) {
    ctx = context;
  },
} as unknown as PluginDefinition;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [accounts] });
  if (!ctx) throw new Error("the plugin's init did not run");
  return current;
}

function plugin(): PluginContext {
  if (!ctx) throw new Error("not booted");
  return ctx;
}

/** A person of the plugin's kind, as its lookup hands one out. */
async function person(id: string): Promise<PrincipalRef> {
  const found = await plugin().principals!.byId("account", id);
  if (!found) throw new Error(`no person ${id}`);
  return found;
}

/** The core writer, through the booted container, with optional secrets. */
function writer(t: TestNextly, secrets?: readonly string[]) {
  return buildAuditLogWriter(
    (name: string) =>
      t.getService(name as Parameters<TestNextly["getService"]>[0]),
    secrets ? { secrets: () => secrets } : {}
  );
}

/** The metadata column, parsed where the dialect stores text. */
function metadataOf(row: AuditRow): Record<string, unknown> | null {
  return typeof row.metadata === "string"
    ? (JSON.parse(row.metadata) as Record<string, unknown>)
    : row.metadata;
}

/** Every audit row, in no particular order. */
function rows(t: TestNextly): Promise<AuditRow[]> {
  return t.adapter.select<AuditRow>("audit_log");
}

/** The one row whose metadata carries `marker`. */
async function rowWith(t: TestNextly, marker: string): Promise<AuditRow> {
  const found = (await rows(t)).filter(
    row => metadataOf(row)?.marker === marker
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** The row with this id. */
async function rowById(t: TestNextly, id: string): Promise<AuditRow> {
  const found = (await rows(t)).filter(row => row.id === id);
  expect(found).toHaveLength(1);
  return found[0];
}

/** The ids of every row, to find the one a write added. */
async function idsOf(t: TestNextly): Promise<Set<string>> {
  return new Set((await rows(t)).map(row => row.id));
}

/** Run `write` and return the id of the one row it added. */
async function added(
  t: TestNextly,
  write: () => Promise<void>
): Promise<string> {
  const before = await idsOf(t);
  await write();
  const fresh = [...(await idsOf(t))].filter(id => !before.has(id));
  expect(fresh).toHaveLength(1);
  return fresh[0];
}

/** A request whose client the plugin's row records. */
function requestFrom(agent: string): Request {
  return new Request("http://localhost/x", {
    headers: { "user-agent": agent },
  });
}

/** Every value in every column of every row, as text. */
async function everyStoredValue(
  t: TestNextly,
  table: string
): Promise<string[]> {
  const all = await t.adapter.select<Record<string, unknown>>(table);
  return all.flatMap(row =>
    Object.values(row).map(value =>
      typeof value === "string" ? value : JSON.stringify(value ?? null)
    )
  );
}

/** A seeded super-admin's id. */
async function superAdminId(t: TestNextly): Promise<string> {
  await seedPermissions(t.adapter, { silent: true });
  const seeded = await seedSuperAdmin(t.adapter, {
    email: "owner@example.com",
    password: "Str0ng-P@ssw0rd!",
    name: "Owner",
    silent: true,
  });
  expect(seeded.success).toBe(true);
  const [user] = await t.adapter.select<{ id: string }>("users", {
    where: { and: [{ column: "email", op: "=", value: "owner@example.com" }] },
  });
  return user.id;
}

/**
 * The booted adapter, with every insert into `auditTable` held at `gate` after
 * signalling `reached`: by then the writer has taken its lock and read whether
 * the person was deleted, and has not yet written its row.
 */
function pausingAdapter(
  t: TestNextly,
  auditTable: unknown,
  reached: () => void,
  gate: Promise<void>
): unknown {
  const real = t.adapter as unknown as {
    dialect: string;
    getCapabilities(): unknown;
    transaction(work: unknown): Promise<unknown>;
    getDrizzle(): object;
  };
  return {
    dialect: real.dialect,
    getCapabilities: () => real.getCapabilities(),
    transaction: (work: unknown) => real.transaction(work),
    getDrizzle: () => pausing(real.getDrizzle(), auditTable, reached, gate),
  };
}

type Method = (...args: unknown[]) => unknown;

function pausing(
  db: object,
  auditTable: unknown,
  reached: () => void,
  gate: Promise<void>
): object {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === "insert") {
        return (table: unknown) => {
          const builder = (value as Method).call(target, table) as {
            values(row: unknown): Promise<unknown>;
          };
          if (table !== auditTable) return builder;
          return {
            values: async (row: unknown) => {
              reached();
              await gate;
              return builder.values(row);
            },
          };
        };
      }
      if (prop === "transaction") {
        return (work: (tx: object) => Promise<unknown>) =>
          (value as Method).call(target, (tx: object) =>
            work(pausing(tx, auditTable, reached, gate))
          );
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "audit rows naming a plugin-defined person (%s)",
  dialect => {
    it("records which kind of caller acted, for each kind", async () => {
      const t = await boot(dialect);
      const staffId = await superAdminId(t);
      const someone = await person("acc_kinds");
      const write = (event: AuditEvent) => writer(t).write(event);

      const staffRow = await added(t, () =>
        write({ kind: "login-succeeded", actorUserId: staffId })
      );
      const keyRow = await added(t, () =>
        write({
          kind: "preview-links-revoked",
          actorKind: "apiKey",
          actorUserId: staffId,
        })
      );
      const coreRow = await added(t, () =>
        write({ kind: "preview-links-revoked", actorKind: "core" })
      );
      const anonymousRow = await added(t, () =>
        write({ kind: "login-failed" })
      );
      const personRow = await added(t, () =>
        plugin().audit!.write({
          kind: "accounts.signed-in",
          actorPrincipal: someone,
        })
      );

      expect((await rowById(t, staffRow)).actorKind).toBe("staff");
      expect((await rowById(t, keyRow)).actorKind).toBe("apiKey");
      expect((await rowById(t, coreRow)).actorKind).toBe("core");
      expect((await rowById(t, anonymousRow)).actorKind).toBe("anonymous");
      const row = await rowById(t, personRow);
      expect(row.actorKind).toBe(KIND);
      expect(row).toMatchObject({
        actorPrincipalKind: KIND,
        actorPrincipalId: "acc_kinds",
        actorUserId: null,
      });
    }, 120_000);

    it("keeps the client and metadata of a plugin row naming a person", async () => {
      const t = await boot(dialect);
      const someone = await person("acc_keeps");

      await plugin().audit!.write({
        kind: "accounts.signed-in",
        actorPrincipal: someone,
        request: requestFrom("member-browser/1.0"),
        metadata: { marker: "keeps", method: "password" },
      });
      // Through the core writer, which takes an address directly.
      await writer(t).write({
        kind: "accounts.changed",
        actorPrincipal: someone,
        ipAddress: "198.51.100.4",
        userAgent: "member-browser/1.0",
        metadata: { marker: "keeps-address", field: "email" },
      } as unknown as AuditEvent);

      const row = await rowWith(t, "keeps");
      expect(row).toMatchObject({
        actorUserId: null,
        actorPrincipalKind: KIND,
        actorPrincipalId: "acc_keeps",
        userAgent: "member-browser/1.0",
      });
      expect(metadataOf(row)).toEqual({ marker: "keeps", method: "password" });
      expect(row.identityErasedAt).toBeFalsy();
      const withAddress = await rowWith(t, "keeps-address");
      expect(withAddress.ipAddress).toBe("198.51.100.4");
      expect(withAddress.identityErasedAt).toBeFalsy();
    }, 120_000);

    it("still stores a plugin row naming a non-staff actorUserId as erased", async () => {
      // The compatibility case: an id that names no staff user, passed where
      // a staff user goes, reads as an erased account's, as it always has.
      const t = await boot(dialect);
      const id = await added(t, () =>
        plugin().audit!.write({
          kind: "accounts.signed-in",
          actorUserId: "acc_not_staff",
          request: requestFrom("member-browser/1.0"),
          metadata: { marker: "compat", method: "password" },
        })
      );
      const row = await rowById(t, id);
      expect(row).toMatchObject({
        actorUserId: "acc_not_staff",
        actorPrincipalId: null,
        userAgent: null,
        metadata: null,
      });
      expect(row.identityErasedAt).toBeTruthy();
    }, 120_000);

    it("erases a reported person's rows, names them by digest, and keeps everyone else's", async () => {
      const t = await boot(dialect);
      const staffId = await superAdminId(t);
      const gone = await person("acc_gone");
      const other = await person("acc_other");

      const acted = await added(t, () =>
        writer(t).write({
          kind: "accounts.signed-in",
          actorPrincipal: gone,
          ipAddress: "198.51.100.10",
          userAgent: "gone-browser/1.0",
          metadata: { marker: "acted", method: "password" },
        } as unknown as AuditEvent)
      );
      // A staff member acting on the person: the address is the staff
      // member's, and stays.
      const actedOn = await added(t, () =>
        writer(t).write({
          kind: "accounts.changed",
          actorUserId: staffId,
          targetPrincipal: gone,
          ipAddress: "203.0.113.20",
          userAgent: "staff-browser/1.0",
          metadata: { marker: "acted-on", field: "email" },
        } as unknown as AuditEvent)
      );
      const untouched = await added(t, () =>
        writer(t).write({
          kind: "accounts.signed-in",
          actorPrincipal: other,
          ipAddress: "198.51.100.30",
          userAgent: "other-browser/1.0",
          metadata: { marker: "other", method: "password" },
        } as unknown as AuditEvent)
      );

      await plugin().principals!.reportDeleted(gone);

      const actedRow = await rowById(t, acted);
      expect(actedRow).toMatchObject({
        actorPrincipalKind: KIND,
        ipAddress: null,
        userAgent: null,
        metadata: null,
      });
      expect(actedRow.identityErasedAt).toBeTruthy();
      expect(actedRow.actorPrincipalId).toMatch(/^[0-9a-f]{64}$/);

      const actedOnRow = await rowById(t, actedOn);
      expect(actedOnRow).toMatchObject({
        actorUserId: staffId,
        ipAddress: "203.0.113.20",
        userAgent: "staff-browser/1.0",
        metadata: null,
      });
      expect(actedOnRow.identityErasedAt).toBeFalsy();
      expect(actedOnRow.targetPrincipalId).toBe(actedRow.actorPrincipalId);

      const otherRow = await rowById(t, untouched);
      expect(otherRow).toMatchObject({
        actorPrincipalId: "acc_other",
        ipAddress: "198.51.100.30",
        userAgent: "other-browser/1.0",
      });
      expect(metadataOf(otherRow)).toEqual({
        marker: "other",
        method: "password",
      });

      // What is kept for the person: a digest and when, and no id anywhere.
      const kept = await t.adapter.select<Record<string, unknown>>(
        "nextly_deleted_principals"
      );
      expect(kept).toHaveLength(1);
      expect(Object.keys(kept[0]).sort()).toEqual(["deletedAt", "digest"]);
      expect(kept[0].digest).toBe(actedRow.actorPrincipalId);
      for (const table of ["audit_log", "nextly_deleted_principals"]) {
        expect(await everyStoredValue(t, table)).not.toContain("acc_gone");
      }
    }, 120_000);

    it("writes a row for a person already reported deleted erased, from a request that resolved them before", async () => {
      const t = await boot(dialect);
      const staffId = await superAdminId(t);
      // Resolved before the report, as a request in flight would have.
      const gone = await person("acc_late");
      await plugin().principals!.reportDeleted(gone);

      const late = await added(t, () =>
        writer(t).write({
          kind: "accounts.signed-in",
          actorPrincipal: gone,
          ipAddress: "198.51.100.40",
          userAgent: "late-browser/1.0",
          metadata: { marker: "late", method: "password" },
        } as unknown as AuditEvent)
      );
      const staffOnLate = await added(t, () =>
        writer(t).write({
          kind: "accounts.changed",
          actorUserId: staffId,
          targetPrincipal: gone,
          ipAddress: "203.0.113.41",
          userAgent: "staff-browser/1.0",
          metadata: { marker: "staff-on-late", field: "email" },
        } as unknown as AuditEvent)
      );

      const row = await rowById(t, late);
      expect(row).toMatchObject({
        ipAddress: null,
        userAgent: null,
        metadata: null,
      });
      expect(row.identityErasedAt).toBeTruthy();
      expect(row.actorPrincipalId).toMatch(/^[0-9a-f]{64}$/);
      const staffRow = await rowById(t, staffOnLate);
      expect(staffRow).toMatchObject({
        ipAddress: "203.0.113.41",
        userAgent: "staff-browser/1.0",
        metadata: null,
        targetPrincipalId: row.actorPrincipalId,
      });
      expect(await everyStoredValue(t, "audit_log")).not.toContain("acc_late");
    }, 120_000);

    it("keeps a staff user's rows apart from a person sharing their id", async () => {
      const t = await boot(dialect);
      const staffId = await superAdminId(t);
      const twin = await person(staffId);

      const staffRow = await added(t, () =>
        writer(t).write({
          kind: "login-succeeded",
          actorUserId: staffId,
          ipAddress: "203.0.113.50",
          userAgent: "staff-browser/1.0",
        })
      );
      const staffPluginRow = await added(t, () =>
        writer(t).write({
          kind: "accounts.changed",
          actorUserId: staffId,
          targetUserId: staffId,
          ipAddress: "203.0.113.51",
          metadata: { marker: "staff-plugin", field: "email" },
        } as unknown as AuditEvent)
      );
      const personRow = await added(t, () =>
        writer(t).write({
          kind: "accounts.signed-in",
          actorPrincipal: twin,
          ipAddress: "198.51.100.52",
          metadata: { marker: "twin", method: "password" },
        } as unknown as AuditEvent)
      );
      // The person's row never reads as the staff user's.
      expect((await rowById(t, personRow)).actorUserId).toBeNull();

      await plugin().principals!.reportDeleted(twin);

      expect(await rowById(t, staffRow)).toMatchObject({
        actorUserId: staffId,
        ipAddress: "203.0.113.50",
        userAgent: "staff-browser/1.0",
      });
      expect((await rowById(t, staffRow)).identityErasedAt).toBeFalsy();
      const staffPlugin = await rowById(t, staffPluginRow);
      expect(staffPlugin.ipAddress).toBe("203.0.113.51");
      expect(metadataOf(staffPlugin)).toEqual({
        marker: "staff-plugin",
        field: "email",
      });
      expect(await rowById(t, personRow)).toMatchObject({
        ipAddress: null,
        metadata: null,
      });
    }, 120_000);

    it("writes a person's row erased after two rotations of the secret", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_rotated");
      const first = "rotation-secret-first-generation-0123456789";
      const second = "rotation-secret-second-generation-012345678";
      const third = "rotation-secret-third-generation-0123456789";

      await reportPrincipalDeleted(gone, {
        adapter: t.adapter as never,
        secrets: [first],
      });
      // One rotation: the earlier secret still configured as the previous.
      await writer(t, [second, first]).write({
        kind: "accounts.signed-in",
        actorPrincipal: gone,
        metadata: { marker: "rotated-once" },
      } as unknown as AuditEvent);
      // A second: the first secret is gone from the configuration.
      const id = await added(t, () =>
        writer(t, [third, second]).write({
          kind: "accounts.signed-in",
          actorPrincipal: gone,
          userAgent: "late-browser/1.0",
          metadata: { marker: "rotated-twice" },
        } as unknown as AuditEvent)
      );

      const row = await rowById(t, id);
      expect(row).toMatchObject({ userAgent: null, metadata: null });
      expect(row.actorPrincipalId).toMatch(/^[0-9a-f]{64}$/);
      const [kept] = await t.adapter.select<{ digest: string }>(
        "nextly_deleted_principals"
      );
      expect(row.actorPrincipalId).toBe(kept.digest);
    }, 120_000);

    it("seals the key again at boot, so two rotations with no write between keep it", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_boot");
      const first = "boot-rotation-secret-first-0123456789abcdef";
      const second = "boot-rotation-secret-second-0123456789abcde";
      const third = "boot-rotation-secret-third-0123456789abcdef";
      const adapter = t.adapter as never;

      await reportPrincipalDeleted(gone, { adapter, secrets: [first] });
      // A boot after the first rotation, and no row naming a person after it.
      await resealPrincipalDigestKeyAtBoot(adapter, [second, first]);
      const id = await added(t, () =>
        writer(t, [third, second]).write({
          kind: "accounts.signed-in",
          actorPrincipal: gone,
          userAgent: "late-browser/1.0",
          metadata: { marker: "after-boot" },
        } as unknown as AuditEvent)
      );
      const row = await rowById(t, id);
      expect(row).toMatchObject({ userAgent: null, metadata: null });
      expect(row.actorPrincipalId).toMatch(/^[0-9a-f]{64}$/);

      // A boot with none of the secrets it is sealed under starts anyway.
      await expect(
        resealPrincipalDigestKeyAtBoot(adapter, [first])
      ).resolves.toBeUndefined();
    }, 120_000);

    it("commits a report with the plugin's own transaction, and rolls it back with it", async () => {
      const t = await boot(dialect);
      const kept = await person("acc_rolled_back");
      const gone = await person("acc_committed");
      const db = plugin().db;

      const failure = new Error("the plugin's own deletion failed");
      await expect(
        db.transaction(async tx => {
          await plugin().principals!.reportDeleted(kept, { tx });
          throw failure;
        })
      ).rejects.toBe(failure);
      expect(await t.adapter.select("nextly_deleted_principals")).toHaveLength(
        0
      );

      await db.transaction(async tx => {
        await plugin().principals!.reportDeleted(gone, { tx });
        // An audit row written inside the reporting transaction joins it
        // rather than waiting on the lock the report holds.
        await plugin().audit!.write({
          kind: "accounts.changed",
          targetPrincipal: gone,
          metadata: { marker: "inside", field: "account" },
        });
      });
      expect(await t.adapter.select("nextly_deleted_principals")).toHaveLength(
        1
      );
      const inside = (await rows(t)).filter(
        row => row.kind === "accounts.changed"
      );
      expect(inside).toHaveLength(1);
      expect(inside[0].targetPrincipalId).toMatch(/^[0-9a-f]{64}$/);
      expect(inside[0].metadata).toBeNull();
    }, 120_000);

    it("refuses a report made inside an open transaction that does not pass it", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_refused");
      await expect(
        plugin().db.transaction(async () => {
          await plugin().principals!.reportDeleted(gone);
        })
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
      expect(await t.adapter.select("nextly_deleted_principals")).toHaveLength(
        0
      );
    }, 120_000);

    it("refuses a report of a person of a kind the plugin does not own", async () => {
      await boot(dialect);
      await expect(
        plugin().principals!.reportDeleted({ kind: "shop:customer", id: "c1" })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }, 120_000);

    it("serialises a report against a writer that checked just before it", async () => {
      // The writer reads that the person is not deleted, the report then
      // starts, and the writer commits only after the report has had every
      // chance to record the person and scan their rows. The row must still
      // end up erased: the report waits for the writer's lock and then finds
      // the row, rather than missing it.
      const t = await boot(dialect);
      const gone = await person("acc_race");
      const { auditLog } = getDialectTables(dialect) as unknown as {
        auditLog: unknown;
      };
      let reached!: () => void;
      const checked = new Promise<void>(resolve => (reached = resolve));
      let release!: () => void;
      const gate = new Promise<void>(resolve => (release = resolve));
      const paused = pausingAdapter(t, auditLog, reached, gate);

      const writing = buildAuditLogWriter((name: string) =>
        name === "adapter"
          ? paused
          : t.getService(name as Parameters<TestNextly["getService"]>[0])
      ).write({
        kind: "accounts.signed-in",
        actorPrincipal: gone,
        userAgent: "racing-browser/1.0",
        metadata: { marker: "race", method: "password" },
      } as unknown as AuditEvent);
      await checked;
      const reporting = plugin().principals!.reportDeleted(gone);
      // Long enough for a report that did not wait to record and scan.
      await new Promise(resolve => setTimeout(resolve, 750));
      release();
      await writing;
      await reporting;

      const all = await rows(t);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ userAgent: null, metadata: null });
      expect(all[0].actorPrincipalId).toMatch(/^[0-9a-f]{64}$/);
    }, 120_000);

    it.runIf(dialect === "sqlite")(
      "keeps an erasure made while another request's transaction is open and then rolls back",
      async () => {
        const t = await boot(dialect);
        const gone = await person("acc_sqlite");
        await writer(t).write({
          kind: "accounts.signed-in",
          actorPrincipal: gone,
          userAgent: "gone-browser/1.0",
          metadata: { marker: "sqlite", method: "password" },
        } as unknown as AuditEvent);

        let opened!: () => void;
        const isOpen = new Promise<void>(resolve => (opened = resolve));
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        const failure = new Error("the other request failed");
        const adapter = t.adapter as unknown as {
          transaction(work: () => Promise<void>): Promise<void>;
        };
        // Another request's transaction, open on the shared connection.
        const other = adapter.transaction(async () => {
          opened();
          await gate;
          throw failure;
        });
        await isOpen;
        // Made from this flow, outside the other one: not refused, queued.
        const reporting = plugin().principals!.reportDeleted(gone);
        await new Promise(resolve => setTimeout(resolve, 200));
        release();
        // The adapter reports the other request's failure as its own error.
        await expect(other).rejects.toThrow(failure.message);
        await reporting;

        const [row] = await rows(t);
        expect(row).toMatchObject({ userAgent: null, metadata: null });
        expect(
          await t.adapter.select("nextly_deleted_principals")
        ).toHaveLength(1);
      },
      120_000
    );

    it("holds a person's id only in the person's own columns", async () => {
      const t = await boot(dialect);
      const someone = await person("acc_columns");

      // A write made as the person names them as its actor, never as a user.
      const actor = runAsPrincipal(
        (await plugin().principals!.byId("account", "acc_columns"))!,
        () => actorForWrite(undefined, null)
      );
      expect(actor).toEqual({
        type: "principal",
        principal: { kind: KIND, id: "acc_columns" },
      });
      expect(actor.id).toBeUndefined();

      await plugin().audit!.write({
        kind: "accounts.signed-in",
        actorPrincipal: someone,
        targetPrincipal: someone,
        metadata: { marker: "columns" },
      });
      const row = await rowWith(t, "columns");
      expect(row).toMatchObject({
        actorUserId: null,
        targetUserId: null,
        actorPrincipalId: "acc_columns",
        targetPrincipalId: "acc_columns",
      });
    }, 120_000);
  }
);
