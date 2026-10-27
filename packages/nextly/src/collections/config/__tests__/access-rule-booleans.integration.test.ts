/**
 * A rule written as `true` or `false` is honoured end to end, and a misspelt
 * access key stops the instance from starting.
 *
 * A collection whose `read` and `create` rules are `true` is read and written
 * by a signed-in person holding the permission on it, and refused to one who
 * holds none, since a rule only narrows the permission; a field whose `read`
 * rule is `false` is withheld from the person, and one whose `update` rule is
 * `false` keeps its value when they change it. A collection naming an access key it
 * does not have (`reed`) is refused when the instance boots, naming the key.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { defineCollection, text } from "../../../config";

const NOTES = "notes";

describe.each(getConfiguredTestDialects())(
  "access rules written as booleans (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let personId: string;
    let strangerId: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: NOTES,
            access: { read: true, create: true, update: true },
            fields: [
              text({ name: "title" }),
              text({ name: "secret", access: { read: false } }),
              text({ name: "locked", access: { update: false } }),
            ],
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
      // The install's first account holds super-admin; the person is another,
      // holding the permissions, and the stranger a third, holding none.
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
        await grantTo(t, personId, action, [NOTES]);
      }
      strangerId = (
        await direct.users.create({
          email: "stranger@example.com",
          password: "Password123!",
          data: { name: "Stranger", isActive: true },
        })
      ).item.id;
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("refuses a person with no permission, whatever a true rule says", async () => {
      const asStranger = new Nextly({
        overrideAccess: false,
        user: { id: strangerId },
      });
      await expect(
        asStranger.create({
          collection: NOTES,
          data: { title: "t" },
        } as never)
      ).rejects.toThrow();
    });

    it("lets a person holding the permission read and write by a true rule, and withholds a false field", async () => {
      const asPerson = new Nextly({
        overrideAccess: false,
        user: { id: personId },
      });
      const created = await asPerson.create({
        collection: NOTES,
        data: { title: "t", secret: "s", locked: "first" },
      } as never);
      const id = String(created.item.id);

      const read = (await asPerson.findByID({
        collection: NOTES,
        id,
      } as never)) as Record<string, unknown>;
      expect(read.title).toBe("t");
      expect(read).not.toHaveProperty("secret");

      await asPerson.update({
        collection: NOTES,
        id,
        data: { title: "t2", locked: "changed" },
      } as never);
      const stored = (await new Nextly().findByID({
        collection: NOTES,
        id,
      } as never)) as Record<string, unknown>;
      expect(stored.title).toBe("t2");
      expect(stored.locked).toBe("first");
      expect(stored.secret).toBe("s");
    });

    it("refuses to start with an access key it does not know, naming it", async () => {
      // A config's collections are defined as it loads, and defining one
      // validates it, so the instance never boots.
      await expect(async () =>
        createTestNextly({
          ...(dialect === "sqlite" ? {} : { dialect }),
          collections: [
            defineCollection({
              slug: "misspelt",
              fields: [text({ name: "title" })],
              access: { reed: () => true } as never,
            }),
          ],
        })
      ).rejects.toThrow(/reed/);
    });
  }
);
