/**
 * `nextly upgrade` hashes a password an earlier release stored as given.
 *
 * Each placement below once kept a password in a container's stored value as
 * it was written: a group or repeater of a collection, a Single or a field
 * group, a field group held inline in one, and a translated container on its
 * companion row. The rows are seeded that way through the adapter, as such a
 * release left them. An upgrade then stores each as a hash of what was
 * written, so the password still verifies; leaves a value already in a
 * hasher's format alone; reports counts and never a value; and a second run
 * finds nothing to do.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from "../../../auth/password";
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
import { isOtherHasherFormat } from "../../../domains/users/services/plaintext-password-cleanup";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { runUpgrade, type UpgradeAdapter } from "../upgrade";

type Doc = Record<string, unknown>;

/** An argon2 string as its library writes it: another hasher's, left alone. */
const ARGON2 =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$4Q2bJ6m6C2i8bS8m5m5m5m5m5m5m5m5m5m5m5m5m5m4";

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Every value under a key named `key`, at any depth. */
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

describe.each(getConfiguredTestDialects())(
  "nextly upgrade hashes passwords stored before this release (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    const lines: string[] = [];
    const logger = {
      info: (msg: string) => lines.push(msg),
      warn: (msg: string) => lines.push(msg),
    };
    const upgrade = () =>
      runUpgrade(
        { confirmBackedUp: true },
        { adapter: t.adapter as unknown as UpgradeAdapter, logger }
      );

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
            slug: "uppin",
            fields: [text({ name: "heading" }), password({ name: "pin" })],
          }),
          defineFieldGroup({
            slug: "upholder",
            fields: [
              text({ name: "heading" }),
              group({
                name: "box",
                fields: [fieldGroup({ name: "held", component: "uppin" })],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "upentries",
            fields: [
              text({ name: "title" }),
              group({
                name: "own",
                fields: [fieldGroup({ name: "held", component: "uppin" })],
              }),
              repeater({
                name: "lines",
                fields: [fieldGroup({ name: "held", component: "uppin" })],
              }),
              // A camel-case container: its column is snake-case in SQL, and the
              // runtime table keys it by the field name.
              group({
                name: "myBox",
                fields: [text({ name: "a" }), password({ name: "pin" })],
              }),
              fieldGroup({ name: "one", component: "upholder" }),
            ],
          }),
          defineCollection({
            slug: "uplocal",
            localized: true,
            fields: [
              text({ name: "title" }),
              group({
                name: "wrap",
                localized: true,
                fields: [fieldGroup({ name: "held", component: "uppin" })],
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "upsite",
            fields: [
              text({ name: "title" }),
              group({
                name: "own",
                fields: [fieldGroup({ name: "held", component: "uppin" })],
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

    async function rowOf(table: string, where: Doc): Promise<Doc> {
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

    /**
     * Store `value` in a container column as an earlier release left it, in
     * the column's own shape: JSON text on SQLite, a JSON value elsewhere.
     */
    async function storeRaw(
      table: string,
      where: Doc,
      column: string,
      value: unknown
    ): Promise<void> {
      await t.adapter.update(
        table,
        { [column]: dialect === "sqlite" ? JSON.stringify(value) : value },
        {
          and: Object.entries(where).map(([name, v]) => ({
            column: name,
            op: "=" as const,
            value: v as string,
          })),
        }
      );
    }

    it("hashes each one in place, leaves a hasher's value alone, and reports only counts", async () => {
      // The fixture's control: this string is one the upgrade must recognise.
      expect(isOtherHasherFormat(ARGON2)).toBe(true);
      const kept = await hashPassword("kept-pin");
      const { item } = await trusted.create({
        collection: "upentries",
        data: {
          title: "e",
          one: { heading: "h", box: { held: { heading: "i", pin: "x" } } },
        },
      } as never);
      const id = String(item.id);
      await storeRaw("dc_upentries", { id }, "own", {
        held: { heading: "o", pin: "own-plain" },
      });
      await storeRaw("dc_upentries", { id }, "lines", [
        { held: { heading: "r", pin: "row-plain" } },
        { held: { heading: "k", pin: kept } },
        { held: { heading: "a", pin: ARGON2 } },
      ]);
      await storeRaw("dc_upentries", { id }, "myBox", {
        a: "1",
        pin: "box-plain",
      });
      const read = (await trusted.findByID({
        collection: "upentries",
        id,
        depth: 0,
      } as never)) as Doc;
      const holderId = String((read.one as Doc | undefined)?.id);
      await storeRaw("comp_upholder", { id: holderId }, "box", {
        held: { heading: "i", pin: "inner-plain" },
      });

      await trusted.updateSingle({
        slug: "upsite",
        data: { title: "s" },
      } as never);
      const [site] = await t.adapter.select<Doc>("single_upsite", {});
      await storeRaw("single_upsite", { id: site?.id }, "own", {
        held: { heading: "s", pin: "site-plain" },
      });

      const { item: local } = await trusted.create({
        collection: "uplocal",
        data: { title: "l", wrap: { held: { heading: "w", pin: "x" } } },
      } as never);
      const localId = String(local.id);
      await trusted.update({
        collection: "uplocal",
        id: localId,
        locale: "es",
        data: { wrap: { held: { heading: "w", pin: "x" } } },
      } as never);
      for (const code of ["en", "es"]) {
        await storeRaw(
          "dc_uplocal_locales",
          { _parent: localId, _locale: code },
          "wrap",
          { held: { heading: "w", pin: `local-${code}` } }
        );
      }

      const readStored = async () => ({
        own: valuesAt((await rowOf("dc_upentries", { id })).own, "pin"),
        lines: valuesAt((await rowOf("dc_upentries", { id })).lines, "pin"),
        box: valuesAt((await rowOf("dc_upentries", { id })).myBox, "pin"),
        inner: valuesAt(
          (await rowOf("comp_upholder", { id: holderId })).box,
          "pin"
        ),
        site: valuesAt(
          (await rowOf("single_upsite", { id: site?.id })).own,
          "pin"
        ),
        en: valuesAt(
          (
            await rowOf("dc_uplocal_locales", {
              _parent: localId,
              _locale: "en",
            })
          ).wrap,
          "pin"
        ),
        es: valuesAt(
          (
            await rowOf("dc_uplocal_locales", {
              _parent: localId,
              _locale: "es",
            })
          ).wrap,
          "pin"
        ),
      });
      const originals = [
        "own-plain",
        "row-plain",
        "box-plain",
        "inner-plain",
        "site-plain",
        "local-en",
        "local-es",
      ];
      const firstOf = (read: Awaited<ReturnType<typeof readStored>>) => [
        read.own[0],
        read.lines[0],
        read.box[0],
        read.inner[0],
        read.site[0],
        read.en[0],
        read.es[0],
      ];
      // The control: every row holds its password as an earlier release left it.
      expect(firstOf(await readStored())).toEqual(originals);

      lines.length = 0;
      await upgrade();

      const stored = await readStored();
      const plain = firstOf(stored).map(
        (value, i) => [value, originals[i]!] as const
      );
      for (const [value, original] of plain) {
        expect(isPasswordHash(value)).toBe(true);
        expect(await verifyPassword(original, value as string)).toBe(true);
      }
      // Already a hash, or in another hasher's format: kept exactly.
      expect(stored.lines[1]).toBe(kept);
      expect(stored.lines[2]).toBe(ARGON2);

      // Counts, and never a value.
      const output = lines.join("\n");
      expect(output).toMatch(/hash passwords stored before this release: 7\b/);
      for (const [, original] of plain) expect(output).not.toContain(original);
      expect(output).not.toContain("Nothing to do");
    });

    it("finds nothing to do on a second run, and changes nothing", async () => {
      const before = await t.adapter.select<Doc>("dc_upentries", {});

      lines.length = 0;
      await upgrade();

      expect(lines.join("\n")).toContain("Already upgraded. Nothing to do.");
      expect(await t.adapter.select<Doc>("dc_upentries", {})).toEqual(before);
    });
  }
);
