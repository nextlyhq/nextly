/**
 * The Direct API leaves hidden fields out where `showHiddenFields` is false.
 *
 * A field is hidden when core's sensitive-field rule says so
 * (`sensitiveFieldPaths`): `admin.hidden`, or a password. `admin.hidden` is a
 * UI flag, so a read returns such a field unless it passes
 * `showHiddenFields: false`, whoever makes it; a field rule is what keeps a
 * value from a caller. With `false`, filtering or sorting on a hidden field is
 * refused: which rows match, and in what order, would disclose it. Password
 * values never come back, whatever a read asks.
 *
 * Checked on every configured dialect, through `find`, `findByID` and
 * `findSingle`.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, password, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import { seedPermissionsAndRolePresets } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { Nextly } from "../nextly";

type Doc = Record<string, unknown>;

const notes = defineCollection({
  slug: "hnotes",
  access: { read: () => true },
  fields: [
    text({ name: "title" }),
    // Maintained by code, never shown to editors: hidden, by core's rule.
    text({ name: "internalCode", admin: { hidden: true } }),
    // A secret by its type: stored hashed, and never read back.
    password({ name: "pin" }),
  ],
});

const settings = defineSingle({
  slug: "hsettings",
  access: { read: () => true },
  fields: [
    text({ name: "siteName" }),
    text({ name: "seedMarker", admin: { hidden: true } }),
  ],
});

const itemsOf = (result: unknown): Doc[] =>
  (result as { items?: Doc[] }).items ?? [];

/** The error a read meets, or undefined when it answers. */
async function refusal(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe.each(getConfiguredTestDialects())(
  "the Direct API's hidden fields (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let visitor: Nextly;
    let id = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [notes],
        singles: [settings],
      });
      // The boot's seeding: the Public role reads `hnotes` and `hsettings`,
      // whose read rules answer `true`.
      await seedPermissionsAndRolePresets();
      trusted = new Nextly();
      visitor = new Nextly({ overrideAccess: false });

      const created = await trusted.create({
        collection: "hnotes",
        data: { title: "Hello", internalCode: "code-42", pin: "Pin-12345!" },
      } as never);
      id = String((created.item as { id: string | number }).id);
      await trusted.users.create({
        data: {
          email: "hidden@example.com",
          password: "Password123!",
          name: "Hidden",
          isActive: true,
        },
      } as never);
      await trusted.updateSingle({
        slug: "hsettings",
        data: { siteName: "Site", seedMarker: "seed-7" },
      } as never);
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    describe("a password", () => {
      it("is left out of every read, a trusted one included, whatever it asks", async () => {
        const reads: Doc[] = [
          ...itemsOf(await trusted.find({ collection: "hnotes" } as never)),
          ...itemsOf(
            await trusted.find({
              collection: "hnotes",
              showHiddenFields: true,
            } as never)
          ),
          (await trusted.findByID({
            collection: "hnotes",
            id,
          } as never)) as Doc,
          ...itemsOf(await visitor.find({ collection: "hnotes" } as never)),
        ];

        expect(reads.map(row => row.title)).toEqual([
          "Hello",
          "Hello",
          "Hello",
          "Hello",
        ]);
        for (const row of reads) expect(row).not.toHaveProperty("pin");
      });

      it("is never returned for an auth user, by a default trusted find", async () => {
        const users = itemsOf(await trusted.users.find({} as never));

        // The control: the user is read, so an absence below is the strip.
        expect(users.map(user => user.email)).toContain("hidden@example.com");
        for (const user of users) {
          expect(user).not.toHaveProperty("password");
          expect(user).not.toHaveProperty("passwordHash");
          expect(user).not.toHaveProperty("password_hash");
        }
      });
    });

    describe("a trusted read", () => {
      it("returns hidden fields when it asks for them, and by default", async () => {
        for (const showHiddenFields of [true, undefined]) {
          const args =
            showHiddenFields === undefined ? {} : { showHiddenFields };
          const [row] = itemsOf(
            await trusted.find({ collection: "hnotes", ...args } as never)
          );
          expect(row).toMatchObject({
            title: "Hello",
            internalCode: "code-42",
          });
        }
      });

      it("leaves them out of find, findByID and findSingle when it passes false", async () => {
        const [row] = itemsOf(
          await trusted.find({
            collection: "hnotes",
            showHiddenFields: false,
          } as never)
        );
        const byId = (await trusted.findByID({
          collection: "hnotes",
          id,
          showHiddenFields: false,
        } as never)) as Doc;
        const single = (await trusted.findSingle({
          slug: "hsettings",
          showHiddenFields: false,
        } as never)) as Doc;

        // The controls: the visible fields are there, so an absence below is
        // the strip and not an empty read.
        expect(row?.title).toBe("Hello");
        expect(byId.title).toBe("Hello");
        expect(single.siteName).toBe("Site");
        expect(row).not.toHaveProperty("internalCode");
        expect(byId).not.toHaveProperty("internalCode");
        expect(single).not.toHaveProperty("seedMarker");
      });

      it("refuses a filter or a sort on a hidden field when it passes false", async () => {
        const filtered = await refusal(
          trusted.find({
            collection: "hnotes",
            where: { internalCode: { equals: "code-42" } },
            showHiddenFields: false,
          } as never)
        );
        const sorted = await refusal(
          trusted.find({
            collection: "hnotes",
            sort: "internalCode",
            showHiddenFields: false,
          } as never)
        );

        expect(NextlyError.isCode(filtered, "VALIDATION_ERROR")).toBe(true);
        expect(NextlyError.isCode(sorted, "VALIDATION_ERROR")).toBe(true);
      });
    });

    describe("every spelling and every Single", () => {
      it("refuses a snake_case alias of a hidden field, as the query resolver accepts it", async () => {
        const filtered = await refusal(
          trusted.find({
            collection: "hnotes",
            where: { internal_code: { equals: "code-42" } },
            showHiddenFields: false,
          } as never)
        );
        const sorted = await refusal(
          trusted.find({
            collection: "hnotes",
            sort: "-internal_code",
            showHiddenFields: false,
          } as never)
        );

        expect(NextlyError.isCode(filtered, "VALIDATION_ERROR")).toBe(true);
        expect(NextlyError.isCode(sorted, "VALIDATION_ERROR")).toBe(true);
      });

      it("leaves hidden fields out of findSingles when it passes false", async () => {
        const listed = (await trusted.findSingles({
          showHiddenFields: false,
        } as never)) as { docs: { slug: string; data: Doc }[] };
        const settingsRow = listed.docs.find(doc => doc.slug === "hsettings");

        expect(settingsRow?.data.siteName).toBe("Site");
        expect(settingsRow?.data).not.toHaveProperty("seedMarker");
      });
    });

    describe("a read judged as a caller", () => {
      it("returns a hidden field its field rules allow, by default", async () => {
        const [row] = itemsOf(
          await visitor.find({ collection: "hnotes" } as never)
        );
        const single = (await visitor.findSingle({
          slug: "hsettings",
        } as never)) as Doc;

        expect(row).toMatchObject({ title: "Hello", internalCode: "code-42" });
        expect(single).toMatchObject({
          siteName: "Site",
          seedMarker: "seed-7",
        });
      });

      it("leaves hidden fields out of find, findByID and findSingle when it passes false", async () => {
        const [row] = itemsOf(
          await visitor.find({
            collection: "hnotes",
            showHiddenFields: false,
          } as never)
        );
        const byId = (await visitor.findByID({
          collection: "hnotes",
          id,
          showHiddenFields: false,
        } as never)) as Doc;
        const single = (await visitor.findSingle({
          slug: "hsettings",
          showHiddenFields: false,
        } as never)) as Doc;

        expect(row?.title).toBe("Hello");
        expect(byId.title).toBe("Hello");
        expect(single.siteName).toBe("Site");
        expect(row).not.toHaveProperty("internalCode");
        expect(byId).not.toHaveProperty("internalCode");
        expect(single).not.toHaveProperty("seedMarker");
      });

      it("refuses a filter or a sort on a hidden field when it passes false", async () => {
        const filtered = await refusal(
          visitor.find({
            collection: "hnotes",
            where: { internalCode: { equals: "code-42" } },
            showHiddenFields: false,
          } as never)
        );
        const sorted = await refusal(
          visitor.find({
            collection: "hnotes",
            sort: "-internalCode",
            showHiddenFields: false,
          } as never)
        );

        expect(NextlyError.isCode(filtered, "VALIDATION_ERROR")).toBe(true);
        expect(NextlyError.isCode(sorted, "VALIDATION_ERROR")).toBe(true);
      });
    });
  }
);
