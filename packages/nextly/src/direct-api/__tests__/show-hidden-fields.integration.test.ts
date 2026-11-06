/**
 * The Direct API leaves hidden fields out where `showHiddenFields` is false.
 *
 * A field is hidden when core's sensitive-field rule says so
 * (`sensitiveFieldPaths`): `admin.hidden`, or a password. `admin.hidden` is a
 * UI flag, so a read returns such a field unless it passes
 * `showHiddenFields: false`, whoever makes it; a field rule is what keeps a
 * value from a caller. With `false`, filtering or sorting on a hidden field is
 * refused: which rows match, and in what order, would disclose it, and so is
 * an aggregate's filter, group key or date field. The refusal comes past the
 * read gate, so a caller who may not read a collection learns nothing of its
 * fields. Password values never come back, whatever a read asks.
 *
 * Checked on every configured dialect, through `find`, `findByID`,
 * `findSingle`, the aggregates and the users namespace, whose custom fields
 * are judged by the same rule.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Each read of a source's declarations (the registry's fields, its components
 * expanded), by slug. Both readers are wrapped, so a read reached through
 * either is seen; each still answers from the real registry.
 */
const declarationReads = vi.hoisted((): string[] => []);

vi.mock("../../runtime/routing/declared-fields", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../runtime/routing/declared-fields")
    >();
  return {
    ...actual,
    expandedFields: (source: {
      kind: "collection" | "single";
      slug: string;
    }) => {
      declarationReads.push(source.slug);
      return actual.expandedFields(source);
    },
    hiddenFieldPaths: (source: {
      kind: "collection" | "single";
      slug: string;
    }) => {
      declarationReads.push(source.slug);
      return actual.hiddenFieldPaths(source);
    },
  };
});

import {
  date,
  defineCollection,
  defineSingle,
  password,
  relationship,
  text,
} from "../../config";
import { getService } from "../../di/service-access";
import { provisionUserFieldStorage } from "../../domains/users/services/provision-user-field-storage";
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

const authors = defineCollection({
  slug: "hauthors",
  access: { read: () => true },
  fields: [
    text({ name: "name" }),
    text({ name: "staffNote", admin: { hidden: true } }),
  ],
});

const notes = defineCollection({
  slug: "hnotes",
  access: { read: () => true },
  fields: [
    text({ name: "title" }),
    // Maintained by code, never shown to editors: hidden, by core's rule.
    text({ name: "internalCode", admin: { hidden: true } }),
    // A secret by its type: stored hashed, and never read back.
    password({ name: "pin" }),
    // A related document, whose own hidden field must not ride along.
    relationship({ name: "author", relationTo: "hauthors" }),
    // A hidden date: what a timeseries would bucket by.
    date({ name: "reviewedAt", admin: { hidden: true } }),
  ],
});

// A collection nobody judged as a caller may read: its rule answers `false`,
// so the boot grants the Public role nothing on it.
const locked = defineCollection({
  slug: "hlocked",
  access: { read: () => false },
  fields: [
    text({ name: "title" }),
    text({ name: "secret", admin: { hidden: true } }),
  ],
});

// Custom user fields, as an app declares them in `users.fields`.
const userFields = [
  text({ name: "nickname" }),
  text({ name: "badge", admin: { hidden: true } }),
];

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

/** The codes of a validation refusal's errors, in order; none for an answer. */
const fieldCodes = (error: unknown): string[] =>
  (
    (error as NextlyError | undefined)?.publicData as
      | { errors?: { code?: string }[] }
      | undefined
  )?.errors?.map(entry => String(entry.code)) ?? [];

/** The argument paths a validation refusal names, as a client attaches them. */
const fieldPaths = (error: unknown): string[] =>
  (
    (error as NextlyError | undefined)?.publicData as
      | { errors?: { path?: string }[] }
      | undefined
  )?.errors?.map(entry => String(entry.path)) ?? [];

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
        collections: [authors, notes, locked],
        singles: [settings],
      });
      // The boot's seeding: the Public role reads `hnotes` and `hsettings`,
      // whose read rules answer `true`.
      await seedPermissionsAndRolePresets();
      trusted = new Nextly();
      visitor = new Nextly({ overrideAccess: false });

      const author = await trusted.create({
        collection: "hauthors",
        data: { name: "Ada", staffNote: "on leave" },
      } as never);
      const created = await trusted.create({
        collection: "hnotes",
        data: {
          title: "Hello",
          internalCode: "code-42",
          pin: "Pin-12345!",
          author: (author.item as { id: string | number }).id,
          reviewedAt: new Date().toISOString(),
        },
      } as never);
      await trusted.create({
        collection: "hlocked",
        data: { title: "Locked", secret: "s-1" },
      } as never);
      // The storage the user fields need, as the boot provisions it.
      await provisionUserFieldStorage({
        codeFields: userFields,
        fieldDefService: getService("userFieldDefinitionService"),
        userExtSchemaService: getService("userExtSchemaService"),
        db: getService("adapter").getDrizzle(),
      });
      id = String((created.item as { id: string | number }).id);
      await trusted.users.create({
        data: {
          email: "hidden@example.com",
          password: "Password123!",
          name: "Hidden",
          isActive: true,
          nickname: "Hid",
          badge: "badge-9",
        },
      } as never);
      await trusted.updateSingle({
        slug: "hsettings",
        data: { siteName: "Site", seedMarker: "seed-7", _overwrite: true },
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

    describe("a related document", () => {
      it("loses its own hidden fields too when a populated read passes false", async () => {
        const [row] = itemsOf(
          await trusted.find({
            collection: "hnotes",
            depth: 1,
            showHiddenFields: false,
          } as never)
        );
        const byId = (await trusted.findByID({
          collection: "hnotes",
          id,
          depth: 1,
          showHiddenFields: false,
        } as never)) as Doc;

        // The controls: the author was populated, so an absence below is the
        // strip and not an id left unexpanded.
        expect(row?.author).toMatchObject({ name: "Ada" });
        expect(byId.author).toMatchObject({ name: "Ada" });
        expect(row?.author).not.toHaveProperty("staffNote");
        expect(byId.author).not.toHaveProperty("staffNote");
      });

      it("keeps them on a populated read that does not pass false", async () => {
        const [row] = itemsOf(
          await trusted.find({ collection: "hnotes", depth: 1 } as never)
        );

        expect(row?.author).toMatchObject({
          name: "Ada",
          staffNote: "on leave",
        });
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

    describe("an aggregate", () => {
      it("refuses a hidden field in count's filter, group's key and timeseries' date field when it passes false", async () => {
        const counted = await refusal(
          trusted.count({
            collection: "hnotes",
            where: { internalCode: { equals: "code-42" } },
            showHiddenFields: false,
          } as never)
        );
        const grouped = await refusal(
          trusted.group({
            collection: "hnotes",
            groupBy: "internalCode",
            showHiddenFields: false,
          } as never)
        );
        const timeline = await refusal(
          trusted.timeseries({
            collection: "hnotes",
            dateField: "reviewedAt",
            interval: "day",
            showHiddenFields: false,
          } as never)
        );

        expect(NextlyError.isCode(counted, "VALIDATION_ERROR")).toBe(true);
        expect(fieldCodes(counted)).toEqual(["FIELD_NOT_FILTERABLE"]);
        expect(NextlyError.isCode(grouped, "VALIDATION_ERROR")).toBe(true);
        expect(fieldCodes(grouped)).toEqual(["FIELD_NOT_GROUPABLE"]);
        expect(fieldPaths(grouped)).toEqual(["groupBy.internalCode"]);
        expect(NextlyError.isCode(timeline, "VALIDATION_ERROR")).toBe(true);
        expect(fieldCodes(timeline)).toEqual(["FIELD_NOT_GROUPABLE"]);
        // Under the argument the caller supplied: a timeline has no groupBy.
        expect(fieldPaths(timeline)).toEqual(["dateField.reviewedAt"]);
      });

      it("answers the same aggregates when they do not pass false, and a visible field when they do", async () => {
        const counted = await trusted.count({
          collection: "hnotes",
          where: { internalCode: { equals: "code-42" } },
        } as never);
        const grouped = await trusted.group({
          collection: "hnotes",
          groupBy: "internalCode",
        } as never);
        const timeline = await trusted.timeseries({
          collection: "hnotes",
          dateField: "reviewedAt",
          interval: "day",
        } as never);
        const visible = await trusted.group({
          collection: "hnotes",
          groupBy: "title",
          where: { title: { equals: "Hello" } },
          showHiddenFields: false,
        } as never);

        expect(counted.total).toBe(1);
        expect(JSON.stringify(grouped.buckets)).toContain("code-42");
        expect(
          timeline.points.reduce((sum, point) => sum + point.count, 0)
        ).toBe(1);
        expect(JSON.stringify(visible.buckets)).toContain("Hello");
      });
    });

    describe("a caller who may not read the collection", () => {
      it("is refused by the read gate, never told that a field it guessed is hidden", async () => {
        const plain = await refusal(
          visitor.find({ collection: "hlocked" } as never)
        );
        const hidden = await refusal(
          visitor.find({
            collection: "hlocked",
            where: { secret: { equals: "s-1" } },
            showHiddenFields: false,
          } as never)
        );
        const unknown = await refusal(
          visitor.find({
            collection: "hlocked",
            where: { noSuchField: { equals: "s-1" } },
            showHiddenFields: false,
          } as never)
        );
        const plainCount = await refusal(
          visitor.count({ collection: "hlocked" } as never)
        );
        const hiddenCount = await refusal(
          visitor.count({
            collection: "hlocked",
            where: { secret: { equals: "s-1" } },
            showHiddenFields: false,
          } as never)
        );
        // The control: past the gate, the same filter is refused as hidden,
        // so the answers above are the gate's and not a filter left unjudged.
        const trustedHidden = await refusal(
          trusted.find({
            collection: "hlocked",
            where: { secret: { equals: "s-1" } },
            showHiddenFields: false,
          } as never)
        );

        expect(NextlyError.is(plain)).toBe(true);
        expect(NextlyError.isCode(plain, "VALIDATION_ERROR")).toBe(false);
        for (const answer of [hidden, unknown]) {
          expect((answer as NextlyError).code).toBe(
            (plain as NextlyError).code
          );
          expect((answer as NextlyError).statusCode).toBe(
            (plain as NextlyError).statusCode
          );
        }
        expect(NextlyError.is(plainCount)).toBe(true);
        expect((hiddenCount as NextlyError).code).toBe(
          (plainCount as NextlyError).code
        );
        expect(fieldCodes(trustedHidden)).toEqual(["FIELD_NOT_FILTERABLE"]);
      });

      it("is refused before any of the collection's declarations are read", async () => {
        const plain = await refusal(
          visitor.find({ collection: "hlocked" } as never)
        );
        declarationReads.length = 0;
        const answers = [
          await refusal(
            visitor.find({
              collection: "hlocked",
              where: { secret: { equals: "s-1" } },
              showHiddenFields: false,
            } as never)
          ),
          await refusal(
            visitor.count({
              collection: "hlocked",
              where: { secret: { equals: "s-1" } },
              showHiddenFields: false,
            } as never)
          ),
          await refusal(
            visitor.group({
              collection: "hlocked",
              groupBy: "secret",
              showHiddenFields: false,
            } as never)
          ),
          await refusal(
            visitor.timeseries({
              collection: "hlocked",
              dateField: "createdAt",
              interval: "day",
              showHiddenFields: false,
            } as never)
          ),
        ];
        const deniedReads = [...declarationReads];
        // The control: the same count by a caller past the gate reads them,
        // so the empty list above is the gate's doing and not a spy unwired.
        await refusal(
          trusted.count({
            collection: "hlocked",
            where: { secret: { equals: "s-1" } },
            showHiddenFields: false,
          } as never)
        );

        for (const answer of answers) {
          expect((answer as NextlyError).code).toBe(
            (plain as NextlyError).code
          );
        }
        expect(deniedReads).toEqual([]);
        expect(declarationReads).toContain("hlocked");
      });
    });

    describe("a user's custom fields", () => {
      it("are left out of users.find, findOne and findByID when a read passes false", async () => {
        const listed = itemsOf(
          await trusted.users.find({ showHiddenFields: false } as never)
        ).find(user => user.email === "hidden@example.com");
        const one = (await trusted.users.findOne({
          search: "hidden@example.com",
          showHiddenFields: false,
        } as never)) as Doc;
        const byId = (await trusted.users.findByID({
          id: String(one.id),
          showHiddenFields: false,
        } as never)) as Doc;

        // The controls: the visible custom field is read, so an absence below
        // is the strip and not a user read without its custom fields.
        expect(listed?.nickname).toBe("Hid");
        expect(one.nickname).toBe("Hid");
        expect(byId.nickname).toBe("Hid");
        expect(listed).not.toHaveProperty("badge");
        expect(one).not.toHaveProperty("badge");
        expect(byId).not.toHaveProperty("badge");
      });

      it("are not matched by a search when a read passes false", async () => {
        const hidden = itemsOf(
          await trusted.users.find({
            search: "badge-9",
            showHiddenFields: false,
          } as never)
        );
        const hiddenOne = await trusted.users.findOne({
          search: "badge-9",
          showHiddenFields: false,
        } as never);
        // The controls: the visible field is matched with false, and the
        // hidden one without it, so an empty answer above is the narrowing.
        const visible = itemsOf(
          await trusted.users.find({
            search: "Hid",
            showHiddenFields: false,
          } as never)
        );
        const kept = itemsOf(
          await trusted.users.find({ search: "badge-9" } as never)
        );

        expect(visible.map(user => user.email)).toContain("hidden@example.com");
        expect(kept.map(user => user.email)).toEqual(["hidden@example.com"]);
        expect(hidden).toEqual([]);
        expect(hiddenOne).toBeNull();
      });

      it("are kept by a read that does not pass false", async () => {
        const listed = itemsOf(await trusted.users.find({} as never)).find(
          user => user.email === "hidden@example.com"
        );

        expect(listed).toMatchObject({ nickname: "Hid", badge: "badge-9" });
      });

      it("refuse a sort by a hidden user field when a read passes false, after the read check", async () => {
        const sorted = await refusal(
          trusted.users.find({
            sortBy: "badge",
            showHiddenFields: false,
          } as never)
        );
        const unsorted = await refusal(
          trusted.users.find({ sortBy: "badge" } as never)
        );
        // A visitor never reads users: it meets that refusal, not this one.
        const visitorPlain = await refusal(visitor.users.find({} as never));
        const visitorSorted = await refusal(
          visitor.users.find({
            sortBy: "badge",
            showHiddenFields: false,
          } as never)
        );

        expect(unsorted).toBeUndefined();
        expect(fieldCodes(sorted)).toEqual(["FIELD_NOT_SORTABLE"]);
        // Under the argument the caller supplied: a users read has no `sort`.
        expect(fieldPaths(sorted)).toEqual(["sortBy.badge"]);
        expect(NextlyError.is(visitorPlain)).toBe(true);
        expect((visitorSorted as NextlyError).code).toBe(
          (visitorPlain as NextlyError).code
        );
      });
    });
  }
);
