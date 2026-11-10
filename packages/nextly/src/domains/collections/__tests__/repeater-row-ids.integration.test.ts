/**
 * Every write stores each repeater row with a saved `id`.
 *
 * A row sent with an id keeps it, the first time its list carries it; a row
 * repeating an id gets a fresh one. A row sent without one keeps the stored
 * row's id only where it is that row unchanged at its own place, and gets a
 * fresh one otherwise, so an id never moves to another row. This holds at
 * every depth (a repeater in a group, a repeater in a repeater's rows, a
 * repeater in a field group's instance) for a collection's create and update
 * through REST and the Direct API, for a Single, and through the restore of a
 * version, which brings the rows back under their ids. A password a row
 * leaves out is still kept, whether or not the writer sends ids.
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
import { restoreVersion } from "../../versions/restore-version";

type Doc = Record<string, unknown>;

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** A stored container's rows, parsed where the dialect keeps them as text. */
const rowsOf = (value: unknown) => (parsed(value) ?? []) as Doc[];

/** The ids of a list of rows, in order. */
const idsOf = (value: unknown) => rowsOf(value).map(row => row.id);

/** Whether every id is a non-empty string and no two are the same. */
function distinctIds(ids: unknown[]): boolean {
  return (
    ids.every(id => typeof id === "string" && id !== "") &&
    new Set(ids).size === ids.length
  );
}

/** Whether `stored` is a hash of `plain`. */
async function hashes(stored: unknown, plain: string): Promise<boolean> {
  return typeof stored === "string" && (await verifyPassword(plain, stored));
}

/** A row set with a nested repeater and a group holding one, sent without ids. */
function idlessEntry(tag: string): Doc {
  return {
    title: tag,
    lines: [
      { label: "a", items: [{ text: "a1" }, { text: "a2" }] },
      { label: "b", items: [{ text: "b1" }] },
    ],
    box: { notes: [{ note: "n1" }, { note: "n2" }] },
  };
}

describe.each(getConfiguredTestDialects())(
  "repeater rows are stored with saved ids (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let editorId: string;
    let cookie = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        fieldGroups: [
          defineFieldGroup({
            slug: "rcard",
            fields: [
              text({ name: "heading" }),
              repeater({ name: "links", fields: [text({ name: "url" })] }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "rentries",
            fields: [
              text({ name: "title" }),
              repeater({
                name: "lines",
                fields: [
                  text({ name: "label" }),
                  repeater({ name: "items", fields: [text({ name: "text" })] }),
                ],
              }),
              group({
                name: "box",
                fields: [
                  repeater({ name: "notes", fields: [text({ name: "note" })] }),
                ],
              }),
              repeater({
                name: "logins",
                fields: [text({ name: "label" }), password({ name: "pw" })],
              }),
            ],
          }),
          // History to restore from: no password, which a restore withholds.
          defineCollection({
            slug: "rversioned",
            versions: true,
            fields: [
              text({ name: "title" }),
              repeater({ name: "lines", fields: [text({ name: "label" })] }),
            ],
          }),
          // A field group placed on the entry, stored in its own table.
          defineCollection({
            slug: "rcards",
            fields: [
              text({ name: "title" }),
              fieldGroup({
                name: "deck",
                component: "rcard",
                repeatable: true,
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "rsite",
            fields: [
              text({ name: "title" }),
              repeater({ name: "lines", fields: [text({ name: "label" })] }),
            ],
          }),
        ],
      } as never);
      trusted = new Nextly();

      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
        seedAllSinglePermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();
      await seeder.seedAllSinglePermissions();
      const perms = await trusted.permissions.find({ limit: 1000 });
      const permissionId = (slug: string) => {
        const found = perms.items.find(p => p.slug === slug);
        expect(found, `\`${slug}\` must be seeded`).toBeDefined();
        return found!.id;
      };
      const roleId = (
        await trusted.roles.create({
          data: {
            name: "row editors",
            slug: "row-editors",
            permissionIds: ["rentries", "rversioned", "rcards"]
              .flatMap(slug => [
                `create-${slug}`,
                `read-${slug}`,
                `update-${slug}`,
              ])
              .map(permissionId),
          },
        })
      ).item.id;
      editorId = String(
        (
          (
            await trusted.users.create({
              email: "row-editor@example.com",
              password: "Password123!",
              data: { name: "Row editor", isActive: true, roles: [roleId] },
            })
          ).item as { id: string }
        ).id
      );
      const token = await signAccessToken(
        buildClaims({
          userId: editorId,
          email: "row-editor@example.com",
          name: "Row editor",
          image: null,
          roleIds: [roleId],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      cookie = `nextly_session=${token}`;
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    function rest(method: "POST" | "PATCH", path: string[], body: unknown) {
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      return handlers[method]!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    async function rawRow(table: string, id: string): Promise<Doc> {
      const rows = await t.adapter.select<Doc>(table, {
        where: { and: [{ column: "id", op: "=" as const, value: id }] },
      });
      return rows[0] ?? {};
    }

    /** A create of a `rentries` entry through `door`. */
    async function createAs(door: "rest" | "direct", data: Doc) {
      if (door === "rest") {
        const res = await rest(
          "POST",
          ["collections", "rentries", "entries"],
          data
        );
        expect(res.status).toBe(201);
        return ((await res.json()) as { item: { id: string } }).item.id;
      }
      const { item } = await trusted.create({
        collection: "rentries",
        data,
      } as never);
      return String(item.id);
    }

    /** An update of a `rentries` entry through `door`. */
    async function updateAs(door: "rest" | "direct", id: string, data: Doc) {
      if (door === "rest") {
        const res = await rest(
          "PATCH",
          ["collections", "rentries", "entries", id],
          { ...data, _overwrite: true }
        );
        expect(res.status).toBe(200);
        return;
      }
      await trusted.update({
        collection: "rentries",
        id,
        data: { ...data, _overwrite: true },
      } as never);
    }

    const stored = (id: string) => rawRow("dc_rentries", id);

    describe.each(["rest", "direct"] as const)("through %s", door => {
      it("gives every row a distinct id on a create sent without any, at every depth", async () => {
        const id = await createAs(door, idlessEntry(`create-${door}`));
        const row = await stored(id);

        const lines = rowsOf(row.lines);
        expect(distinctIds(idsOf(row.lines))).toBe(true);
        expect(distinctIds(lines.flatMap(line => idsOf(line.items)))).toBe(
          true
        );
        expect(
          distinctIds(idsOf((parsed(row.box) as Doc | undefined)?.notes))
        ).toBe(true);
      });

      it("keeps every id when the same rows are saved again without ids", async () => {
        const id = await createAs(door, idlessEntry(`resave-${door}`));
        const before = await stored(id);

        await updateAs(door, id, idlessEntry(`resave-${door}`));
        const after = await stored(id);

        expect(idsOf(after.lines)).toEqual(idsOf(before.lines));
        expect(rowsOf(after.lines).map(line => idsOf(line.items))).toEqual(
          rowsOf(before.lines).map(line => idsOf(line.items))
        );
        expect(idsOf((parsed(after.box) as Doc).notes)).toEqual(
          idsOf((parsed(before.box) as Doc).notes)
        );
      });

      it("moves each id with its row when rows are reordered with their ids", async () => {
        const id = await createAs(door, idlessEntry(`reorder-${door}`));
        const [a, b] = rowsOf((await stored(id)).lines);

        await updateAs(door, id, { lines: [b, a] });
        const rows = rowsOf((await stored(id)).lines);

        expect(rows.map(row => [row.label, row.id])).toEqual([
          ["b", b?.id],
          ["a", a?.id],
        ]);
      });

      it("never moves an id to another row when rows are reordered without ids", async () => {
        const id = await createAs(door, idlessEntry(`swap-${door}`));
        const before = rowsOf((await stored(id)).lines);

        await updateAs(door, id, {
          lines: [
            { label: "b", items: [{ text: "b1" }] },
            { label: "a", items: [{ text: "a1" }, { text: "a2" }] },
          ],
        });
        const rows = rowsOf((await stored(id)).lines);

        // Neither row is the stored one at its place, so each takes a fresh
        // id rather than the other's.
        const storedIds = new Set(before.map(row => row.id));
        expect(rows.every(row => !storedIds.has(row.id))).toBe(true);
        expect(distinctIds(rows.map(row => row.id))).toBe(true);
      });

      it("stores a row sent with a repeated id under an id of its own", async () => {
        const id = await createAs(door, {
          title: `dup-${door}`,
          lines: [{ id: "row-1", label: "a" }],
        });

        await updateAs(door, id, {
          lines: [
            { id: "row-1", label: "a" },
            { id: "row-1", label: "copy" },
          ],
        });
        const rows = rowsOf((await stored(id)).lines);

        expect(rows[0]?.id).toBe("row-1");
        expect(distinctIds(rows.map(row => row.id))).toBe(true);
        expect(rows.map(row => row.label)).toEqual(["a", "copy"]);
      });

      it("keeps a row's password, and its id, when it is saved again without either", async () => {
        const id = await createAs(door, {
          title: `pw-${door}`,
          logins: [
            { label: "a", pw: "secret-a" },
            { label: "b", pw: "secret-b" },
          ],
        });
        const before = idsOf((await stored(id)).logins);

        // As a writer that never sends ids saves it: each row without its
        // password, which reads never return.
        await updateAs(door, id, {
          logins: [{ label: "a" }, { label: "b" }],
        });
        const rows = rowsOf((await stored(id)).logins);

        expect(await hashes(rows[0]?.pw, "secret-a")).toBe(true);
        expect(await hashes(rows[1]?.pw, "secret-b")).toBe(true);
        // The rows hold their stored hashes again, so they are unchanged and
        // keep their ids.
        expect(rows.map(row => row.id)).toEqual(before);
      });
    });

    it("brings rows back under their ids when a version is restored", async () => {
      const { item } = await trusted.create({
        collection: "rversioned",
        data: { title: "v1", lines: [{ label: "a" }, { label: "b" }] },
      } as never);
      const id = String(item.id);
      const v1 = rowsOf((await rawRow("dc_rversioned", id)).lines);
      expect(distinctIds(v1.map(row => row.id))).toBe(true);

      // A second version: one row edited, one removed, one added.
      await trusted.update({
        collection: "rversioned",
        id,
        data: {
          title: "v2",
          lines: [{ id: v1[0]?.id, label: "a, edited" }, { label: "c" }],
          _overwrite: true,
        },
      } as never);

      await restoreVersion({
        scopeKind: "collection",
        slug: "rversioned",
        entryId: id,
        versionNo: 1,
        user: { id: editorId },
        version: { _overwrite: true },
      } as never);
      const rows = rowsOf((await rawRow("dc_rversioned", id)).lines);

      expect(rows.map(row => [row.label, row.id])).toEqual(
        v1.map(row => [row.label, row.id])
      );
    });

    it("gives ids to a repeater's rows inside a field group's instance, and keeps them", async () => {
      const { item } = await trusted.create({
        collection: "rcards",
        data: {
          title: "c",
          deck: [{ heading: "h", links: [{ url: "/a" }, { url: "/b" }] }],
        },
      } as never);
      const id = String(item.id);
      const read = async () =>
        (await trusted.findByID({
          collection: "rcards",
          id,
          depth: 1,
        } as never)) as Doc;
      const deck = rowsOf((await read()).deck);
      const links = idsOf(deck[0]?.links);
      expect(distinctIds(links)).toBe(true);

      // The instance sent back by its id, its rows without theirs: unchanged,
      // so each keeps its id; a new row gets one of its own.
      await trusted.update({
        collection: "rcards",
        id,
        data: {
          deck: [
            {
              id: deck[0]?.id,
              heading: "h",
              links: [{ url: "/a" }, { url: "/b" }, { url: "/c" }],
            },
          ],
          _overwrite: true,
        },
      } as never);
      const after = idsOf(rowsOf((await read()).deck)[0]?.links);

      expect(after.slice(0, 2)).toEqual(links);
      expect(distinctIds(after)).toBe(true);
    });

    it("gives a Single's rows ids, and keeps them when they are saved again without", async () => {
      const save = () =>
        trusted.updateSingle({
          slug: "rsite",
          data: {
            title: "s",
            lines: [{ label: "a" }, { label: "b" }],
            _overwrite: true,
          },
        } as never);
      const lines = async () =>
        idsOf(
          ((await trusted.findSingle({ slug: "rsite" } as never)) as Doc).lines
        );

      await save();
      const first = await lines();
      expect(distinctIds(first)).toBe(true);

      await save();
      expect(await lines()).toEqual(first);
    });
  }
);
