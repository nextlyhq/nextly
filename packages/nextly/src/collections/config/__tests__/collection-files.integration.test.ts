/**
 * A collection whose entries are files, against a real database: its file
 * fields are made as columns, no caller writes them through a checked path,
 * the storage key is never read through one, and the Public role is granted
 * nothing on it at boot, though its read rule answers `true` for a visitor.
 *
 * Each refusal has a control beside it that the same caller, or the same
 * rule on a collection without files, is allowed, so a gate refusing
 * everything would fail as surely as one refusing nothing.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, text } from "../../../config";
import { PUBLIC_ROLE_SLUG } from "../../../domains/auth/services/public-role";
import { Nextly } from "../../../direct-api/nextly";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { MemoryPrivateStorage } from "../../../domains/files/__tests__/memory-private-storage";

const CONTRACTS = "contracts";
const NOTES = "notes";
const KEY = "files/contracts/0b8a3c1e-6f00-4c1d-9a7e-2f5d6c7b8a90";

describe.each(getConfiguredTestDialects())(
  "a collection holding files (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let personId: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // A collection with files starts only on storage that keeps them private.
        storagePlugins: [new MemoryPrivateStorage().plugin([CONTRACTS])],
        collections: [
          defineCollection({
            slug: CONTRACTS,
            files: {
              visibility: "private",
              accept: ["application/pdf"],
              maxSize: 1024 * 1024,
            },
            // Answers `true` for anyone, visitors included: the boot must
            // still not hand the Public role a read of the files.
            access: { read: () => true, create: true, update: true },
            fields: [text({ name: "note" })],
          }),
          defineCollection({
            slug: NOTES,
            access: { read: () => true },
            fields: [text({ name: "note" })],
          }),
        ],
      });
      const direct = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
      };
      // The first account holds super-admin; the person is another.
      await direct.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      personId = (
        await direct.users.create({
          email: "person@example.com",
          password: "Password123!",
          data: { name: "Person", isActive: true },
        })
      ).item.id;
      for (const action of ["read", "create", "update"]) {
        await grantTo(t, personId, action, [CONTRACTS]);
      }
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    const asPerson = () =>
      new Nextly({ overrideAccess: false, user: { id: personId } });
    const trusted = () => new Nextly();
    const stored = async (id: string) =>
      (await trusted().findByID({
        collection: CONTRACTS,
        id,
      } as never)) as Record<string, unknown>;

    it("ignores every file field a caller sends, keeping the author's own", async () => {
      const created = await asPerson().create({
        collection: CONTRACTS,
        data: {
          title: "A contract",
          slug: "a-contract",
          note: "kept",
          fileStatus: "ready",
          storageKey: "files/other/somewhere",
          size: 1,
          mimeType: "application/pdf",
          uploadedById: "someone-else",
        },
      } as never);
      const row = await stored(String(created.item.id));
      expect(row.note).toBe("kept");
      // Never what the caller sent; nothing a caller writes makes a file ready.
      expect([null, "pending"]).toContain(row.fileStatus ?? null);
      for (const field of ["storageKey", "size", "mimeType", "uploadedById"]) {
        expect(row[field] ?? null, field).toBeNull();
      }
    });

    it("starts an entry trusted code makes without a status pending", async () => {
      const created = await trusted().create({
        collection: CONTRACTS,
        data: { title: "C contract", slug: "c-contract", note: "n" },
      } as never);
      expect((await stored(String(created.item.id))).fileStatus).toBe(
        "pending"
      );
    });

    it("withholds the storage key from a checked read, and keeps a file's fields through a checked update", async () => {
      const created = await trusted().create({
        collection: CONTRACTS,
        data: {
          title: "B contract",
          slug: "b-contract",
          note: "first",
          storageKey: KEY,
          fileStatus: "pending",
          size: 2048,
        },
      } as never);
      const id = String(created.item.id);
      // Trusted code reads and writes them: the routes that own them will.
      expect(await stored(id)).toMatchObject({ storageKey: KEY, size: 2048 });

      const read = (await asPerson().findByID({
        collection: CONTRACTS,
        id,
      } as never)) as Record<string, unknown>;
      expect(read).toMatchObject({
        note: "first",
        fileStatus: "pending",
        size: 2048,
      });
      expect(read).not.toHaveProperty("storageKey");
      const listed = await asPerson().find({ collection: CONTRACTS } as never);
      for (const item of (listed as { items: Array<Record<string, unknown>> })
        .items) {
        expect(item).not.toHaveProperty("storageKey");
      }

      await asPerson().update({
        collection: CONTRACTS,
        id,
        data: {
          note: "second",
          fileStatus: "ready",
          storageKey: "files/other/elsewhere",
          size: 1,
          _overwrite: true,
        },
      } as never);
      expect(await stored(id)).toMatchObject({
        note: "second",
        fileStatus: "pending",
        storageKey: KEY,
        size: 2048,
      });
    });

    it("grants the Public role no read of the files, though the rule answers true", async () => {
      // The start's seeding, run here as the Public-grant tests run it.
      await seedPermissionsAndRolePresets();
      const services = new ServiceContainer(t.adapter);
      const role = await services.roles.findRoleIdBySlug(PUBLIC_ROLE_SLUG);
      if (!role) throw new Error("no Public role");
      const held = (
        await services.rolePermissions.listRolePermissions(role.id)
      ).map(p => `${p.action}-${p.resource}`);
      // Control: the same rule on a collection without files is granted.
      expect(held).toContain(`read-${NOTES}`);
      expect(held).not.toContain(`read-${CONTRACTS}`);
    });
  }
);
