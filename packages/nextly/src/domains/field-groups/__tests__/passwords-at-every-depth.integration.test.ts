/**
 * A password is stored hashed and never returned, at every depth.
 *
 * The field group `pwpin` carries a password `pin`. It is placed:
 * - directly on an entry (`direct`), stored in its own table: the control;
 * - inline in a collection's group (`own.held`) and repeater (`rows[].held`);
 * - inline in a group of another field group (`one.box.held`), which is
 *   itself stored in its own table;
 * - inline in a Single's group (`own.held`).
 *
 * Wherever it sits, the stored value is a hash of what was written, and no
 * read returns a `pin` at all: trusted or checked, by id or in a list, through
 * the Direct API or REST.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { verifyPassword } from "../../../auth/password";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  password,
  repeater,
  text,
} from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

type Doc = Record<string, unknown>;

/** A stored container column, parsed where the dialect keeps it as text. */
function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Every value held under a key named `key`, at any depth of `value`. */
function valuesAt(value: unknown, key: string): unknown[] {
  const found: unknown[] = [];
  const visit = (node: unknown) => {
    const open = parsed(node);
    if (Array.isArray(open)) {
      open.forEach(visit);
      return;
    }
    if (open === null || typeof open !== "object") return;
    for (const [name, child] of Object.entries(open as Doc)) {
      if (name === key) found.push(child);
      visit(child);
    }
  };
  visit(value);
  return found;
}

/** Whether `stored` is a hash of `plain`. */
async function hashes(stored: unknown, plain: string): Promise<boolean> {
  return typeof stored === "string" && (await verifyPassword(plain, stored));
}

describe.each(getConfiguredTestDialects())(
  "a password stored at any depth (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let checked: Nextly;
    let readerCookie = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        fieldGroups: [
          defineFieldGroup({
            slug: "pwpin",
            fields: [text({ name: "heading" }), password({ name: "pin" })],
          }),
          defineFieldGroup({
            slug: "pwholder",
            fields: [
              text({ name: "heading" }),
              group({
                name: "box",
                fields: [fieldGroup({ name: "held", component: "pwpin" })],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "pwentries",
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              group({
                name: "own",
                fields: [fieldGroup({ name: "held", component: "pwpin" })],
              }),
              repeater({
                name: "lines",
                fields: [fieldGroup({ name: "held", component: "pwpin" })],
              }),
              fieldGroup({ name: "one", component: "pwholder" }),
              fieldGroup({ name: "direct", component: "pwpin" }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "pwsite",
            access: { read: () => true, update: () => true },
            fields: [
              text({ name: "title" }),
              group({
                name: "own",
                fields: [fieldGroup({ name: "held", component: "pwpin" })],
              }),
            ],
          }),
        ],
      } as never);
      trusted = new Nextly();
      checked = new Nextly({ overrideAccess: false });
      const reader = (
        await trusted.users.create({
          email: "reader@example.com",
          password: "Password123!",
          data: { name: "Reader", isActive: true },
        } as never)
      ).item as { id: string };
      readerCookie = `nextly_session=${await signAccessToken(
        buildClaims({
          userId: String(reader.id),
          email: "reader@example.com",
          name: "Reader",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      )}`;
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    async function restGet(path: string[]): Promise<unknown> {
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      const res = await handlers.GET!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method: "GET",
          headers: { cookie: readerCookie },
        }),
        { params: Promise.resolve({ params: path }) }
      );
      expect(res.status).toBe(200);
      return res.json();
    }

    async function rawRow(table: string, id: string): Promise<Doc> {
      const rows = await t.adapter.select<Doc>(table, {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      return rows[0] ?? {};
    }

    async function seededEntry(tag: string): Promise<string> {
      const { item } = await trusted.create({
        collection: "pwentries",
        data: {
          title: tag,
          own: { held: { heading: "o", pin: `own-${tag}` } },
          lines: [{ held: { heading: "r", pin: `row-${tag}` } }],
          one: {
            heading: "h",
            box: { held: { heading: "i", pin: `in-${tag}` } },
          },
          direct: { heading: "d", pin: `direct-${tag}` },
        },
      } as never);
      return String(item.id);
    }

    describe("a collection", () => {
      it("stores a hash wherever the password sits", async () => {
        const id = await seededEntry("c");
        const row = await rawRow("dc_pwentries", id);

        expect(await hashes(valuesAt(row.own, "pin")[0], "own-c")).toBe(true);
        expect(await hashes(valuesAt(row.lines, "pin")[0], "row-c")).toBe(true);
        const read = (await trusted.findByID({
          collection: "pwentries",
          id,
          depth: 0,
        } as never)) as Doc;
        const holderId = String((read.one as Doc | undefined)?.id);
        const holder = await rawRow("comp_pwholder", holderId);
        expect(await hashes(valuesAt(holder.box, "pin")[0], "in-c")).toBe(true);
      });

      it("stores a hash when an update writes the password", async () => {
        const id = await seededEntry("u");

        await trusted.update({
          collection: "pwentries",
          id,
          data: {
            own: { held: { heading: "o", pin: "own-u2" } },
            lines: [{ held: { heading: "r", pin: "row-u2" } }],
          },
        } as never);
        const row = await rawRow("dc_pwentries", id);

        expect(await hashes(valuesAt(row.own, "pin")[0], "own-u2")).toBe(true);
        expect(await hashes(valuesAt(row.lines, "pin")[0], "row-u2")).toBe(
          true
        );
      });

      it("returns no password from any read", async () => {
        const id = await seededEntry("r");

        const reads: unknown[] = [
          await trusted.findByID({
            collection: "pwentries",
            id,
            depth: 1,
          } as never),
          await checked.findByID({
            collection: "pwentries",
            id,
            depth: 1,
          } as never),
          await checked.find({ collection: "pwentries", depth: 1 } as never),
          await restGet(["collections", "pwentries", "entries", id]),
          await restGet(["collections", "pwentries", "entries"]),
        ];

        for (const read of reads) expect(valuesAt(read, "pin")).toEqual([]);
      });
    });

    describe("a Single", () => {
      it("stores a hash, and returns no password from any read", async () => {
        await trusted.updateSingle({
          slug: "pwsite",
          data: {
            title: "s",
            own: { held: { heading: "o", pin: "site-pin" } },
          },
        } as never);
        const [row] = await t.adapter.select<Doc>("single_pwsite", {});

        expect(await hashes(valuesAt(row?.own, "pin")[0], "site-pin")).toBe(
          true
        );
        const reads: unknown[] = [
          await trusted.findSingle({ slug: "pwsite" } as never),
          await checked.findSingle({ slug: "pwsite" } as never),
          await restGet(["singles", "pwsite"]),
        ];
        for (const read of reads) expect(valuesAt(read, "pin")).toEqual([]);
      });
    });

    it("hashes and withholds a field group placed directly on the entry", async () => {
      // The control: this placement is hashed and withheld already.
      const id = await seededEntry("d");
      const read = (await trusted.findByID({
        collection: "pwentries",
        id,
        depth: 1,
      } as never)) as Doc;

      expect(valuesAt(read.direct, "pin")).toEqual([]);
      const directId = String((read.direct as Doc | undefined)?.id);
      const stored = await rawRow("comp_pwpin", directId);
      expect(await hashes(stored.pin, "direct-d")).toBe(true);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a password in a translated container, read in every language (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: {
          locales: ["en", "es"],
          defaultLocale: "en",
          fallback: false,
        },
        fieldGroups: [
          defineFieldGroup({
            slug: "pwlpin",
            fields: [text({ name: "heading" }), password({ name: "pin" })],
          }),
        ],
        collections: [
          defineCollection({
            slug: "pwlentries",
            localized: true,
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              // A password of the collection's own, and one in a field group
              // held inline, each in a translated group.
              group({
                name: "own",
                localized: true,
                fields: [text({ name: "a" }), password({ name: "pin" })],
              }),
              group({
                name: "wrap",
                localized: true,
                fields: [fieldGroup({ name: "held", component: "pwlpin" })],
              }),
            ],
          }),
        ],
      } as never);
      trusted = new Nextly();
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("returns no password from a read of every language", async () => {
      const { item } = await trusted.create({
        collection: "pwlentries",
        data: {
          title: "t",
          own: { a: "1", pin: "own-en" },
          wrap: { held: { heading: "h", pin: "in-en" } },
        },
      } as never);
      const id = String(item.id);
      await trusted.update({
        collection: "pwlentries",
        id,
        locale: "es",
        data: {
          own: { a: "2", pin: "own-es" },
          wrap: { held: { heading: "h", pin: "in-es" } },
        },
      } as never);

      for (const reader of [trusted, new Nextly({ overrideAccess: false })]) {
        const read = await reader.findByID({
          collection: "pwlentries",
          id,
          locale: "all",
        } as never);
        // Every language's value is there, and no password in any of them.
        expect(valuesAt(read, "a")).toEqual(["1", "2"]);
        expect(valuesAt(read, "pin")).toEqual([]);
      }
    });
  }
);
