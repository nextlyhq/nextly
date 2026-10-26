/**
 * A password inside a group is kept when an edit doesn't resend it.
 *
 * Reads never return a stored password, so an edit, the admin's included,
 * sends a container without it. Wherever the password sits inside a container
 * written whole (a group or repeater of a collection, a Single or a field
 * group, or a field group held inline in one), an update that leaves it out
 * or sends it empty keeps the stored hash; `null` clears it and a new value
 * replaces it. Repeater rows keep theirs by id, and a translated container
 * keeps the written language's.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyPassword } from "../../../auth/password";
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

type Doc = Record<string, unknown>;

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** A stored container's value, parsed where the dialect keeps it as text. */
const open = (value: unknown) => parsed(value) as Doc;
const rowsOf = (value: unknown) => (parsed(value) ?? []) as Doc[];

/** Whether `stored` is a hash of `plain`. */
async function hashes(stored: unknown, plain: string): Promise<boolean> {
  return typeof stored === "string" && (await verifyPassword(plain, stored));
}

describe.each(getConfiguredTestDialects())(
  "a password inside a container is kept when an edit leaves it out (%s)",
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
            slug: "kpin",
            fields: [text({ name: "heading" }), password({ name: "pin" })],
          }),
          defineFieldGroup({
            slug: "kbox",
            fields: [
              text({ name: "heading" }),
              group({
                name: "box",
                fields: [
                  text({ name: "a" }),
                  password({ name: "secret" }),
                  fieldGroup({ name: "held", component: "kpin" }),
                ],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "kentries",
            fields: [
              text({ name: "title" }),
              password({ name: "top" }),
              group({
                name: "acct",
                fields: [text({ name: "email" }), password({ name: "pw" })],
              }),
              group({
                name: "held",
                fields: [fieldGroup({ name: "nested", component: "kpin" })],
              }),
              repeater({
                name: "lines",
                fields: [text({ name: "label" }), password({ name: "pw" })],
              }),
              fieldGroup({ name: "fg", component: "kbox" }),
              fieldGroup({ name: "direct", component: "kpin" }),
            ],
          }),
          defineCollection({
            slug: "klocal",
            localized: true,
            fields: [
              text({ name: "title" }),
              group({
                name: "wrap",
                localized: true,
                fields: [text({ name: "a" }), password({ name: "pw" })],
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "ksite",
            fields: [
              text({ name: "title" }),
              group({
                name: "own",
                fields: [text({ name: "a" }), password({ name: "pw" })],
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

    async function rawRow(table: string, where: Doc): Promise<Doc> {
      const rows = await t.adapter.select<Doc>(table, {
        where: {
          and: Object.entries(where).map(([column, value]) => ({
            column,
            op: "=" as const,
            value: value as string,
          })),
        },
      });
      return rows[0] ?? {};
    }

    async function entry(data: Doc): Promise<string> {
      const { item } = await trusted.create({
        collection: "kentries",
        data: { title: "e", ...data },
      } as never);
      return String(item.id);
    }

    const update = (id: string, data: Doc) =>
      trusted.update({ collection: "kentries", id, data } as never);

    it("keeps a group's password, and a field group's held in one, when an edit leaves it out", async () => {
      const id = await entry({
        acct: { email: "a@example.com", pw: "acct-1" },
        held: { nested: { heading: "h", pin: "held-1" } },
      });

      await update(id, {
        acct: { email: "b@example.com" },
        held: { nested: { heading: "h2" } },
      });
      const row = await rawRow("dc_kentries", { id });

      expect(open(row.acct).email).toBe("b@example.com");
      expect(await hashes(open(row.acct).pw, "acct-1")).toBe(true);
      expect(open(open(row.held).nested).heading).toBe("h2");
      expect(await hashes(open(open(row.held).nested).pin, "held-1")).toBe(
        true
      );
    });

    it("keeps it when an edit sends it empty", async () => {
      const id = await entry({
        acct: { email: "a@example.com", pw: "acct-1" },
      });

      await update(id, { acct: { email: "a@example.com", pw: "" } });

      const row = await rawRow("dc_kentries", { id });
      expect(await hashes(open(row.acct).pw, "acct-1")).toBe(true);
    });

    it("clears it on null, and replaces it with a new value", async () => {
      const id = await entry({
        acct: { email: "a@example.com", pw: "acct-1" },
      });

      await update(id, { acct: { email: "a@example.com", pw: "acct-2" } });
      expect(
        await hashes(
          open((await rawRow("dc_kentries", { id })).acct).pw,
          "acct-2"
        )
      ).toBe(true);

      await update(id, { acct: { email: "a@example.com", pw: null } });
      expect(open((await rawRow("dc_kentries", { id })).acct).pw ?? null).toBe(
        null
      );
    });

    it("keeps each repeater row's password by its id, and gives a new or repeated row none", async () => {
      // Rows carry the ids their writer gave them, as the admin's do.
      const idA = "row-a-id";
      const idB = "row-b-id";
      const id = await entry({
        lines: [
          { id: idA, label: "a", pw: "row-a" },
          { id: idB, label: "b", pw: "row-b" },
        ],
      });
      // The control: the stored rows keep those ids.
      expect(
        rowsOf((await rawRow("dc_kentries", { id })).lines).map(row => row.id)
      ).toEqual([idA, idB]);

      // Reordered, a new row added, and row a's id sent twice.
      await update(id, {
        lines: [
          { id: idB, label: "b" },
          { id: idA, label: "a" },
          { label: "new" },
          { id: idA, label: "a again" },
        ],
      });
      const rows = rowsOf((await rawRow("dc_kentries", { id })).lines);

      expect(rows.map(row => row.label)).toEqual(["b", "a", "new", "a again"]);
      expect(await hashes(rows[0]?.pw, "row-b")).toBe(true);
      expect(await hashes(rows[1]?.pw, "row-a")).toBe(true);
      expect(rows[2]?.pw ?? null).toBe(null);
      expect(rows[3]?.pw ?? null).toBe(null);
    });

    it("keeps a password inside a field group's own group, and one held inline there", async () => {
      const id = await entry({
        fg: {
          heading: "f",
          box: {
            a: "1",
            secret: "box-1",
            held: { heading: "i", pin: "inner-1" },
          },
        },
      });
      const read = (await trusted.findByID({
        collection: "kentries",
        id,
        depth: 0,
      } as never)) as Doc;
      const instanceId = String((read.fg as Doc | undefined)?.id);

      await update(id, {
        fg: {
          id: instanceId,
          heading: "f2",
          box: { a: "2", held: { heading: "i2" } },
        },
      });
      const row = await rawRow("comp_kbox", { id: instanceId });

      expect(row.heading).toBe("f2");
      expect(open(row.box).a).toBe("2");
      expect(await hashes(open(row.box).secret, "box-1")).toBe(true);
      expect(await hashes(open(open(row.box).held).pin, "inner-1")).toBe(true);
    });

    it("keeps a Single's group password", async () => {
      await trusted.updateSingle({
        slug: "ksite",
        data: { title: "s", own: { a: "1", pw: "site-1" } },
      } as never);

      await trusted.updateSingle({
        slug: "ksite",
        data: { own: { a: "2" } },
      } as never);
      const [row] = await t.adapter.select<Doc>("single_ksite", {});

      expect(open(row?.own).a).toBe("2");
      expect(await hashes(open(row?.own).pw, "site-1")).toBe(true);
    });

    it("keeps only the written language's password in a translated group", async () => {
      const { item } = await trusted.create({
        collection: "klocal",
        data: { title: "l", wrap: { a: "1", pw: "en-1" } },
      } as never);
      const id = String(item.id);
      await trusted.update({
        collection: "klocal",
        id,
        locale: "es",
        data: { wrap: { a: "1", pw: "es-1" } },
      } as never);

      await trusted.update({
        collection: "klocal",
        id,
        locale: "es",
        data: { wrap: { a: "2" } },
      } as never);
      const es = open(
        (await rawRow("dc_klocal_locales", { _parent: id, _locale: "es" })).wrap
      );
      const en = open(
        (await rawRow("dc_klocal_locales", { _parent: id, _locale: "en" })).wrap
      );

      expect(es.a).toBe("2");
      expect(await hashes(es.pw, "es-1")).toBe(true);
      expect(await hashes(es.pw, "en-1")).toBe(false);
      expect(await hashes(en.pw, "en-1")).toBe(true);
    });

    it("keeps, as before, a password column of the entry and a field group placed directly", async () => {
      // The controls: these placements are kept already.
      const id = await entry({
        top: "top-1",
        direct: { heading: "d", pin: "direct-1" },
      });
      await update(id, { title: "e2", direct: { heading: "d2" } });

      const row = await rawRow("dc_kentries", { id });
      expect(await hashes(row.top, "top-1")).toBe(true);
      const read = (await trusted.findByID({
        collection: "kentries",
        id,
        depth: 1,
      } as never)) as Doc;
      const directId = String((read.direct as Doc | undefined)?.id);
      const direct = await rawRow("comp_kpin", { id: directId });
      expect(direct.heading).toBe("d2");
      expect(await hashes(direct.pin, "direct-1")).toBe(true);
    });
  }
);
