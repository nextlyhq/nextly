/**
 * A hidden column a schema hook contributes to a core table stays out of every
 * public read and write of that table's records, and the core's own writes
 * keep working once it is added. The five tables a hook may extend are each
 * covered: `users` and `media` through REST, the Direct API (media uploads
 * and the top-level account methods included), and a relationship or upload
 * field that populates them; `nextly_jobs` and
 * `activity_log` through the one route each that lists their rows (and,
 * for jobs, the route that runs them); and
 * `audit_log`, which no public route reads, through its writer alone.
 *
 * The column is declared by a plugin's hook and then added to the live table,
 * as the app's migration would add it, and holds a sentinel value. Every read
 * is searched for the sentinel by value, so the column is caught under any
 * spelling a response could give it; every write names it in both spellings,
 * and the stored value is read back from the table to show it did not move.
 *
 * Each read also asserts a field the record does carry, so a response that
 * withheld the whole record cannot pass as one that withheld the column.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  getColumns,
  getTableName,
  isTable,
  type Table,
} from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Only the storage backend is stubbed, so an upload runs the real media
// service and writes the real row without putting a file in the checkout.
vi.mock("@nextly/storage", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMediaStorage: vi.fn(() => ({
    upload: vi.fn(async (_buffer: Buffer, options: { filename: string }) => ({
      url: `https://test.local/${options.filename}`,
      path: options.filename,
    })),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    getPublicUrl: vi.fn((path: string) => `https://test.local/${path}`),
    getStorageType: vi.fn().mockReturnValue("local"),
  })),
}));

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { createMediaHandlers } from "../../../api/media-handlers";
import { defineCollection, relationship, text, upload } from "../../../config";
import { getDialectTables } from "../../../database/index";
import type { ServiceMap } from "../../../di/register";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { defineJob } from "../../jobs/job-registry";
import { pdfDocument } from "../../../services/upload-validation/__tests__/format-fixtures";
import { buildAuditLogWriter } from "../../audit/audit-log-writer";

import { hiddenColumnNames } from "./active-schema";
import { col } from "./dsl";
import { EXTENDABLE_CORE_TABLES } from "./extension-columns";

/** What the hidden column holds. Searched for in every response. */
const SENTINEL = "hidden-sentinel-7f3a";
/** What each write tries to put there. Must never reach the table. */
const ATTEMPT = "written-through-api-9c1e";

const hiddenColumns = { leakProbe: col.text({ nullable: true }) };

/** The ids of the jobs the contributed handler ran, so a run is observable. */
const ranJobs: string[] = [];

const contributor = definePlugin({
  name: "@test/leak-probe",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    jobs: [
      defineJob({
        slug: "leak-probe.sweep",
        handler: async (_input, context) => {
          ranJobs.push(context.jobId);
        },
      }),
    ],
    schema: {
      extend: [
        ({ schema }) => {
          for (const table of EXTENDABLE_CORE_TABLES) {
            schema.extendTable(table, { columns: hiddenColumns });
          }
        },
      ],
    },
  },
});

interface Direct {
  users: {
    create(a: Record<string, unknown>): Promise<{ item: { id: string } }>;
    find(a?: Record<string, unknown>): Promise<unknown>;
    findOne(a?: Record<string, unknown>): Promise<unknown>;
    findByID(a: Record<string, unknown>): Promise<unknown>;
    update(a: Record<string, unknown>): Promise<unknown>;
    delete(a: Record<string, unknown>): Promise<unknown>;
  };
  media: {
    upload(a: Record<string, unknown>): Promise<{ id: string }>;
    find(a?: Record<string, unknown>): Promise<unknown>;
    findByID(a: Record<string, unknown>): Promise<unknown>;
    update(a: Record<string, unknown>): Promise<unknown>;
    delete(a: Record<string, unknown>): Promise<unknown>;
    bulkDelete(a: Record<string, unknown>): Promise<unknown>;
  };
  jobs: {
    queue(a: Record<string, unknown>): Promise<{ id: string }>;
  };
  login(a: Record<string, unknown>): Promise<unknown>;
  me(a: Record<string, unknown>): Promise<unknown>;
  updateMe(a: Record<string, unknown>): Promise<unknown>;
  register(a: Record<string, unknown>): Promise<{ user: { id: string } }>;
  changePassword(a: Record<string, unknown>): Promise<unknown>;
  create(a: Record<string, unknown>): Promise<{ item: { id: string } }>;
  find(a: Record<string, unknown>): Promise<unknown>;
  findByID(a: Record<string, unknown>): Promise<unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a hidden column on the extendable core tables (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    let ownerId: string;
    let memberId: string;
    let postId: string;
    let headers: Record<string, string>;
    const mediaId = "probe-media-1";

    /**
     * The core tables this file has a section for, recorded by the sections
     * themselves as they are declared. The column is contributed to every
     * table in `EXTENDABLE_CORE_TABLES`, and a guard fails when that set names
     * a table with no section, so a table made extendable later cannot go
     * untested while this suite stays green.
     */
    const sections = new Set<string>();
    function section(table: string, body: () => void): void {
      sections.add(table);
      describe(table, body);
    }

    async function sql(statement: string): Promise<Record<string, unknown>[]> {
      return (await t.adapter.executeQuery(statement)) as Record<
        string,
        unknown
      >[];
    }

    async function stored(table: "users" | "media", id: string) {
      const rows = await sql(
        `SELECT leak_probe FROM ${table} WHERE id = '${id}'`
      );
      return rows[0]?.leak_probe;
    }

    /**
     * The hidden column of each row a core write stored, found by a column the
     * write set. One row exactly, so a write that failed in silence (the audit
     * and activity writers swallow their own errors) reads as no row rather
     * than as an empty column.
     */
    async function storedBy(
      table: string,
      column: string,
      value: string
    ): Promise<unknown[]> {
      const rows = await sql(
        `SELECT leak_probe FROM ${table} WHERE ${column} = '${value}'`
      );
      return rows.map(row => row.leak_probe ?? null);
    }

    /** A user to delete, holding the sentinel like every other row. */
    async function disposableUser(email: string): Promise<string> {
      const id = (
        await direct.users.create({
          email,
          password: "Password123!",
          data: { name: email, isActive: true },
        })
      ).item.id;
      await sql(
        `UPDATE users SET leak_probe = '${SENTINEL}' WHERE id = '${id}'`
      );
      return id;
    }

    /** A media row to delete or file, holding the sentinel. */
    async function disposableMedia(
      id: string,
      folderId: string | null = null
    ): Promise<void> {
      await t.adapter.insert("media", {
        id,
        filename: `${id}.pdf`,
        originalFilename: `${id}.pdf`,
        mimeType: "application/pdf",
        size: 1,
        url: `/uploads/${id}.pdf`,
        folderId,
        uploadedBy: ownerId,
        uploadedAt: new Date("2020-01-01T00:00:00Z"),
        updatedAt: new Date("2020-01-01T00:00:00Z"),
      });
      await sql(
        `UPDATE media SET leak_probe = '${SENTINEL}' WHERE id = '${id}'`
      );
    }

    async function rowCount(table: "users" | "media", id: string) {
      return (await sql(`SELECT id FROM ${table} WHERE id = '${id}'`)).length;
    }

    /** The response, serialised, so the sentinel is found under any key. */
    function serialised(value: unknown): string {
      return JSON.stringify(value);
    }

    /**
     * Neither the column nor anything written at it is in a response: not the
     * stored sentinel, not the value a write attempted, and not the key in
     * either spelling, which a response would carry even holding `null`.
     */
    function expectNoHiddenColumn(out: string): void {
      expect(out).not.toContain(SENTINEL);
      expect(out).not.toContain(ATTEMPT);
      expect(out).not.toContain('"leakProbe"');
      expect(out).not.toContain('"leak_probe"');
    }

    function rest(
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string[],
      body?: unknown,
      query = ""
    ) {
      const handlers = createDynamicHandlers();
      return handlers[method](
        new Request(`http://localhost/api/${path.join("/")}${query}`, {
          method,
          headers: {
            ...headers,
            // Same-origin, as the browser sends it: a session-authenticated
            // trigger route refuses a POST without it.
            origin: "http://localhost",
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    function mediaRest(
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string[],
      body?: unknown
    ) {
      // The admin mount: authenticated, and serving writes as well as reads.
      const handlers = createMediaHandlers({ requireAuth: true });
      // A form is sent as it is, so the runtime sets its multipart boundary.
      const isForm = body instanceof FormData;
      return handlers[method](
        new Request(`http://localhost/api/media/${path.join("/")}`, {
          method,
          headers: {
            ...headers,
            ...(body === undefined || isForm
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined
            ? {}
            : { body: isForm ? body : JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ path }) }
      );
    }

    async function bodyOf(res: Response): Promise<string> {
      const text = await res.text();
      expect(res.status, text).toBeLessThan(300);
      return text;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [contributor],
        collections: [
          defineCollection({
            slug: "posts",
            fields: [
              text({ name: "title" }),
              relationship({ name: "author", relationTo: "users" }),
              upload({ name: "cover", relationTo: "media" }),
            ],
          }),
        ],
      });
      direct = t.nextly as unknown as Direct;
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();

      // The install's first account is the owner; the probe acts on a second,
      // ordinary one.
      ownerId = (
        await direct.users.create({
          email: "owner@example.com",
          password: "Password123!",
          data: { name: "Owner", isActive: true },
        })
      ).item.id;
      memberId = (
        await direct.users.create({
          email: "member@example.com",
          password: "Password123!",
          data: { name: "Member", isActive: true },
        })
      ).item.id;

      await t.adapter.insert("media", {
        id: mediaId,
        filename: "probe.pdf",
        originalFilename: "probe.pdf",
        mimeType: "application/pdf",
        size: 1,
        url: "/uploads/probe.pdf",
        uploadedBy: ownerId,
        uploadedAt: new Date("2020-01-01T00:00:00Z"),
        updatedAt: new Date("2020-01-01T00:00:00Z"),
      });

      // The column the app's migration adds, added here directly, then the
      // value only the contributor should ever see.
      for (const table of EXTENDABLE_CORE_TABLES) {
        await sql(`ALTER TABLE ${table} ADD COLUMN leak_probe TEXT`);
      }
      await sql(`UPDATE users SET leak_probe = '${SENTINEL}'`);
      await sql(`UPDATE media SET leak_probe = '${SENTINEL}'`);

      postId = (
        await direct.create({
          collection: "posts",
          data: { title: "Probe", author: memberId, cover: mediaId },
          overrideAccess: true,
        })
      ).item.id;

      const token = await signAccessToken(
        buildClaims({
          userId: ownerId,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      headers = { cookie: `nextly_session=${token}` };
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("the fixture holds the sentinel in both tables", async () => {
      expect(await stored("users", memberId)).toBe(SENTINEL);
      expect(await stored("media", mediaId)).toBe(SENTINEL);
    });

    it("the plugin's contribution is registered as hidden on every table", () => {
      // Without this, every check below would also pass if the hook never
      // ran, or if the column it declared were named other than the one the
      // fixture adds: the static tables lack the column either way.
      for (const table of EXTENDABLE_CORE_TABLES) {
        expect(hiddenColumnNames(table), table).toEqual(["leak_probe"]);
      }
    });

    it("the search finds the sentinel in a read that does return the column", async () => {
      // The positive control for every read below: a whole-row read of the
      // live table carries the column, and the same search reports it. A
      // search that could not see the column would pass every read for the
      // wrong reason.
      for (const table of ["users", "media"] as const) {
        const whole = serialised(await sql(`SELECT * FROM ${table}`));
        expect(whole).toContain(SENTINEL);
        expect(whole).toContain('"leak_probe"');
      }
    });

    it("covers every core table a hook may extend", () => {
      expect([...EXTENDABLE_CORE_TABLES].sort()).toEqual([...sections].sort());
    });

    section("users", () => {
      it("Direct API find", async () => {
        const out = serialised(await direct.users.find({ limit: 50 }));
        expect(out).toContain("member@example.com");
        expectNoHiddenColumn(out);
      });

      it("Direct API findByID", async () => {
        const out = serialised(await direct.users.findByID({ id: memberId }));
        expect(out).toContain("member@example.com");
        expectNoHiddenColumn(out);
      });

      it("REST list", async () => {
        const out = await bodyOf(await rest("GET", ["users"]));
        expect(out).toContain("member@example.com");
        expectNoHiddenColumn(out);
      });

      it("REST by id", async () => {
        const out = await bodyOf(await rest("GET", ["users", memberId]));
        expect(out).toContain("member@example.com");
        expectNoHiddenColumn(out);
      });

      it("REST me", async () => {
        const out = await bodyOf(await rest("GET", ["me"]));
        expect(out).toContain("owner@example.com");
        expectNoHiddenColumn(out);
      });

      it("Direct API findOne", async () => {
        const out = serialised(
          await direct.users.findOne({ search: "member@example.com" })
        );
        expect(out).toContain("member@example.com");
        expectNoHiddenColumn(out);
      });

      it("a relationship populated at depth 1 (Direct API and REST)", async () => {
        const viaDirect = serialised(
          await direct.findByID({
            collection: "posts",
            id: postId,
            depth: 1,
            overrideAccess: true,
          })
        );
        expect(viaDirect).toContain("member@example.com");
        expectNoHiddenColumn(viaDirect);

        const viaRest = await bodyOf(
          await rest("GET", ["collections", "posts", "entries", postId])
        );
        expect(viaRest).toContain("member@example.com");
        expectNoHiddenColumn(viaRest);
      });

      it("Direct API login, me and updateMe return no hidden column, and updateMe cannot set it", async () => {
        // The top-level account methods read and write `users` through the
        // auth and account services, apart from the `users` namespace.
        const loggedIn = serialised(
          await direct.login({
            email: "member@example.com",
            password: "Password123!",
          })
        );
        expect(loggedIn).toContain("member@example.com");
        expectNoHiddenColumn(loggedIn);

        const me = serialised(await direct.me({ user: { id: memberId } }));
        expect(me).toContain("member@example.com");
        expectNoHiddenColumn(me);

        const updated = serialised(
          await direct.updateMe({
            user: { id: memberId },
            data: {
              name: "Member Me",
              leakProbe: ATTEMPT,
              leak_probe: ATTEMPT,
            },
          })
        );
        expect(updated).toContain("Member Me");
        expectNoHiddenColumn(updated);
        expect(await stored("users", memberId)).toBe(SENTINEL);
      });

      it("Direct API register and changePassword succeed, return no hidden column, and cannot set it", async () => {
        const registered = await direct.register({
          email: "registered@example.com",
          password: "Password123!",
          name: "Registered",
          leakProbe: ATTEMPT,
          leak_probe: ATTEMPT,
        });
        const registeredOut = serialised(registered);
        expect(registeredOut).toContain("registered@example.com");
        expectNoHiddenColumn(registeredOut);
        const id = registered.user.id;
        expect(await stored("users", id)).toBeNull();

        await sql(
          `UPDATE users SET leak_probe = '${SENTINEL}' WHERE id = '${id}'`
        );
        const hashOf = async () =>
          (await sql(`SELECT password_hash FROM users WHERE id = '${id}'`))[0]
            ?.password_hash;
        const before = await hashOf();
        expect(before).toBeTruthy();
        expectNoHiddenColumn(
          serialised(
            await direct.changePassword({
              user: { id },
              currentPassword: "Password123!",
              newPassword: "Password456!",
            })
          )
        );
        // The change took (a self-registered account cannot sign in before
        // verifying its address, so the stored hash is what shows it), and
        // the column kept its value through the account write.
        expect(await hashOf()).not.toBe(before);
        expect(await stored("users", id)).toBe(SENTINEL);
      });

      it("Direct API and REST delete succeed and return no hidden column", async () => {
        const viaDirect = await disposableUser("delete-direct@example.com");
        const directOut = serialised(
          await direct.users.delete({ id: viaDirect })
        );
        expect(directOut).toContain(viaDirect);
        expectNoHiddenColumn(directOut);
        expect(await rowCount("users", viaDirect)).toBe(0);

        const viaRest = await disposableUser("delete-rest@example.com");
        const restOut = await bodyOf(await rest("DELETE", ["users", viaRest]));
        expectNoHiddenColumn(restOut);
        expect(await rowCount("users", viaRest)).toBe(0);
      });

      it("Direct API update cannot set it", async () => {
        const out = serialised(
          await direct.users.update({
            id: memberId,
            data: { name: "Member 2", leakProbe: ATTEMPT, leak_probe: ATTEMPT },
          })
        );
        expect(out).toContain("Member 2");
        expectNoHiddenColumn(out);
        expect(await stored("users", memberId)).toBe(SENTINEL);
      });

      it("REST update cannot set it", async () => {
        const out = await bodyOf(
          await rest("PATCH", ["users", memberId], {
            name: "Member 3",
            leakProbe: ATTEMPT,
            leak_probe: ATTEMPT,
          })
        );
        expect(out).toContain("Member 3");
        expectNoHiddenColumn(out);
        expect(await stored("users", memberId)).toBe(SENTINEL);
      });

      it("REST me update cannot set it", async () => {
        const out = await bodyOf(
          await rest("PATCH", ["me"], {
            name: "Owner 2",
            leakProbe: ATTEMPT,
            leak_probe: ATTEMPT,
          })
        );
        // The ordinary update happened, so the request reached the write the
        // hidden key could have ridden on.
        expect(out).toContain("Owner 2");
        expect(
          (await sql(`SELECT name FROM users WHERE id = '${ownerId}'`))[0]?.name
        ).toBe("Owner 2");
        expectNoHiddenColumn(out);
        expect(await stored("users", ownerId)).toBe(SENTINEL);
      });

      it("Direct API and REST create cannot set it, and the create succeeds", async () => {
        const created = await direct.users.create({
          email: "direct-new@example.com",
          password: "Password123!",
          data: { name: "New", leakProbe: ATTEMPT, leak_probe: ATTEMPT },
        });
        expect(serialised(created)).toContain("direct-new@example.com");
        expectNoHiddenColumn(serialised(created));
        expect(await stored("users", created.item.id)).toBeNull();

        const res = await rest("POST", ["users"], {
          email: "rest-new@example.com",
          password: "Password123!",
          name: "Rest New",
          leakProbe: ATTEMPT,
          leak_probe: ATTEMPT,
        });
        const out = await bodyOf(res);
        expect(out).toContain("rest-new@example.com");
        expectNoHiddenColumn(out);
        const rows = await sql(
          `SELECT leak_probe FROM users WHERE email = 'rest-new@example.com'`
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.leak_probe ?? null).toBeNull();
      });
    });

    section("media", () => {
      it("Direct API find and findByID", async () => {
        const list = serialised(await direct.media.find({ limit: 50 }));
        expect(list).toContain("probe.pdf");
        expectNoHiddenColumn(list);

        const one = serialised(await direct.media.findByID({ id: mediaId }));
        expect(one).toContain("probe.pdf");
        expectNoHiddenColumn(one);
      });

      it("REST list and by id", async () => {
        const list = await bodyOf(await mediaRest("GET", []));
        expect(list).toContain("probe.pdf");
        expectNoHiddenColumn(list);

        const one = await bodyOf(await mediaRest("GET", [mediaId]));
        expect(one).toContain("probe.pdf");
        expectNoHiddenColumn(one);
      });

      it("an upload field populated at depth 1 (Direct API and REST)", async () => {
        const viaDirect = serialised(
          await direct.findByID({
            collection: "posts",
            id: postId,
            depth: 1,
            overrideAccess: true,
          })
        );
        expect(viaDirect).toContain("probe.pdf");
        expectNoHiddenColumn(viaDirect);

        const viaRest = await bodyOf(
          await rest("GET", ["collections", "posts", "entries", postId])
        );
        expect(viaRest).toContain("probe.pdf");
        expectNoHiddenColumn(viaRest);
      });

      it("a collection list populating both at depth 1 (Direct API and REST)", async () => {
        // A list reads its entries and populates them through a path of its
        // own, apart from the by-id read above.
        const viaDirect = serialised(
          await direct.find({
            collection: "posts",
            depth: 1,
            overrideAccess: true,
          })
        );
        const viaRest = await bodyOf(
          await rest(
            "GET",
            ["collections", "posts", "entries"],
            undefined,
            "?depth=1"
          )
        );
        for (const out of [viaDirect, viaRest]) {
          expect(out).toContain("member@example.com");
          expect(out).toContain("probe.pdf");
          expectNoHiddenColumn(out);
        }
      });

      it("REST folder contents, at the root and in a folder", async () => {
        const root = await bodyOf(
          await mediaRest("GET", ["folders", "root", "contents"])
        );
        expect(root).toContain("probe.pdf");
        expectNoHiddenColumn(root);

        const folder = await bodyOf(
          await mediaRest("POST", ["folders"], { name: "Probe folder" })
        );
        const folderId = (JSON.parse(folder) as { item: { id: string } }).item
          .id;
        await disposableMedia("probe-filed", folderId);
        const contents = await bodyOf(
          await mediaRest("GET", ["folders", folderId, "contents"])
        );
        expect(contents).toContain("probe-filed.pdf");
        expectNoHiddenColumn(contents);
      });

      it("Direct API and REST delete and bulk delete succeed and return no hidden column", async () => {
        for (const id of [
          "del-direct",
          "del-rest",
          "bulk-direct",
          "bulk-rest",
        ]) {
          await disposableMedia(id);
        }
        const outs = [
          serialised(await direct.media.delete({ id: "del-direct" })),
          await bodyOf(await mediaRest("DELETE", ["del-rest"])),
          serialised(await direct.media.bulkDelete({ ids: ["bulk-direct"] })),
          await bodyOf(
            await mediaRest("DELETE", ["bulk"], { mediaIds: ["bulk-rest"] })
          ),
        ];
        for (const out of outs) expectNoHiddenColumn(out);
        for (const id of [
          "del-direct",
          "del-rest",
          "bulk-direct",
          "bulk-rest",
        ]) {
          expect(await rowCount("media", id), id).toBe(0);
        }
      });

      it("Direct API update cannot set it", async () => {
        const out = serialised(
          await direct.media.update({
            id: mediaId,
            data: { altText: "alt 1", leakProbe: ATTEMPT, leak_probe: ATTEMPT },
          })
        );
        expect(out).toContain("alt 1");
        expectNoHiddenColumn(out);
        expect(await stored("media", mediaId)).toBe(SENTINEL);
      });

      it("REST update cannot set it", async () => {
        const out = await bodyOf(
          await mediaRest("PATCH", [mediaId], {
            altText: "alt 2",
            leakProbe: ATTEMPT,
            leak_probe: ATTEMPT,
          })
        );
        expect(out).toContain("alt 2");
        expectNoHiddenColumn(out);
        expect(await stored("media", mediaId)).toBe(SENTINEL);
      });

      it("Direct API and REST upload succeed, return no hidden column, and cannot set it", async () => {
        // An upload inserts and returns its row through code of its own, not
        // the update path above, so it is checked on both surfaces. As with
        // the media updates, what this holds is the public surface: neither
        // surface hands a key it does not name to the media service, so the
        // service's own handling of one is not reached from here.
        const direct1 = pdfDocument("direct-upload");
        const viaDirect = await direct.media.upload({
          file: {
            data: direct1,
            name: "direct-upload.pdf",
            mimetype: "application/pdf",
            size: direct1.length,
          },
          user: { id: ownerId },
          // The column named beside the upload's own arguments, in both
          // spellings, as the REST form below names it.
          leakProbe: ATTEMPT,
          leak_probe: ATTEMPT,
        });
        const directOut = serialised(viaDirect);
        expect(directOut).toContain("direct-upload");
        expectNoHiddenColumn(directOut);
        expect(await stored("media", viaDirect.id)).toBeNull();

        const rest1 = pdfDocument("rest-upload");
        const form = new FormData();
        form.append(
          "file",
          new File([new Uint8Array(rest1)], "rest-upload.pdf", {
            type: "application/pdf",
          })
        );
        // The column named in the form too, in both spellings.
        form.append("leakProbe", ATTEMPT);
        form.append("leak_probe", ATTEMPT);
        const restOut = await bodyOf(await mediaRest("POST", [], form));
        expect(restOut).toContain("rest-upload");
        expectNoHiddenColumn(restOut);
        const restId = (JSON.parse(restOut) as { item: { id: string } }).item
          .id;
        expect(await stored("media", restId)).toBeNull();
      });
    });

    section("nextly_jobs", () => {
      it("the queue's own write succeeds, cannot set it, and the jobs list never returns it", async () => {
        const queued = await direct.jobs.queue({
          task: "leak-probe.sweep",
          input: { pass: 1 },
          // The column named beside the queue's own arguments, in both
          // spellings.
          leakProbe: ATTEMPT,
          leak_probe: ATTEMPT,
        });
        expect(typeof queued.id).toBe("string");
        expectNoHiddenColumn(serialised(queued));
        // The core's write, after the column was added: one row, the hidden
        // column untouched.
        expect(await storedBy("nextly_jobs", "id", queued.id)).toEqual([null]);

        await sql(`UPDATE nextly_jobs SET leak_probe = '${SENTINEL}'`);
        expect(serialised(await sql("SELECT * FROM nextly_jobs"))).toContain(
          SENTINEL
        );
        const out = await bodyOf(await rest("GET", ["jobs"]));
        expect(out).toContain("leak-probe.sweep");
        expectNoHiddenColumn(out);
      });

      it("the runner claims and completes a job, keeping the column and returning none of it", async () => {
        // `POST /api/jobs/run` claims the row, runs it and records the
        // outcome: three writes of its own to `nextly_jobs`.
        const queued = await direct.jobs.queue({
          task: "leak-probe.sweep",
          input: { pass: 2 },
        });
        await sql(
          `UPDATE nextly_jobs SET leak_probe = '${SENTINEL}' WHERE id = '${queued.id}'`
        );
        const out = await bodyOf(await rest("POST", ["jobs", "run"], {}));
        expectNoHiddenColumn(out);
        expect(ranJobs).toContain(queued.id);
        const [row] = await sql(
          `SELECT state, leak_probe FROM nextly_jobs WHERE id = '${queued.id}'`
        );
        expect(row).toEqual({ state: "done", leak_probe: SENTINEL });
      });
    });

    section("activity_log", () => {
      it("the activity log's own write succeeds, and the dashboard feed never returns it", async () => {
        const activity = t.getService("activityLogService") as unknown as {
          logActivity(input: Record<string, unknown>): Promise<unknown>;
        };
        await activity.logActivity({
          actorType: "user",
          userId: ownerId,
          action: "create",
          collection: "posts",
          entryTitle: "Probe activity",
        });
        expect(
          await storedBy("activity_log", "entry_title", "Probe activity")
        ).toEqual([null]);

        await sql(`UPDATE activity_log SET leak_probe = '${SENTINEL}'`);
        expect(serialised(await sql("SELECT * FROM activity_log"))).toContain(
          SENTINEL
        );
        const out = await bodyOf(
          await rest("GET", ["dashboard", "activity"], undefined, "?limit=50")
        );
        expect(out).toContain("Probe activity");
        expectNoHiddenColumn(out);
      });
    });

    section("audit_log", () => {
      // No REST route, Direct API method or admin loader reads this table, so
      // there is no public read to search. What is left is the core's own
      // write, which must still store its row once the column is added.
      it("the audit writer's own write succeeds", async () => {
        await buildAuditLogWriter((name: string) =>
          t.getService(name as keyof ServiceMap)
        ).write({
          kind: "csrf-failed",
          metadata: { path: "/leak-probe", method: "POST" },
        });
        expect(await storedBy("audit_log", "kind", "csrf-failed")).toEqual([
          null,
        ]);
      });
    });

    describe("every reader of a core table", () => {
      // The paths above are the public surfaces, listed one by one. Under
      // them, a core table's rows are read through the static table bundle,
      // the schema registry by SQL name, or the adapter's whole-row select,
      // which resolves through that registry; the relational query config
      // closes over the bundle's own table objects. With the contribution
      // declared and the column live, none of these reads it, so a surface
      // built on them is held without being listed.
      //
      // Two things this does not hold. The adapter's raw insert inside a
      // transaction answers with every column (`RETURNING *`, or a re-read
      // with `SELECT *` on MySQL), so a caller asking it for the inserted row
      // would get the column; the one such insert on these tables, the media
      // upload, asks for no columns back. And the column is added after boot,
      // as `nextly migrate` adds it: no boot path builds a core table from
      // the live database today, and one that did would be checked only by a
      // boot that finds the column already there.
      it("none of the three returns the column, on any extendable core table", async () => {
        // A row in each table, written here so the check stands on its own.
        await direct.jobs.queue({ task: "leak-probe.guard", input: null });
        await (
          t.getService("activityLogService") as unknown as {
            logActivity(input: Record<string, unknown>): Promise<unknown>;
          }
        ).logActivity({
          actorType: "user",
          userId: ownerId,
          action: "create",
          collection: "posts",
          entryTitle: "Guard activity",
        });
        await buildAuditLogWriter((name: string) =>
          t.getService(name as keyof ServiceMap)
        ).write({ kind: "password-changed" });

        const columnNames = (table: unknown): string[] =>
          Object.values(getColumns(table as Table)).map(
            column => column.name
          );
        const bundle = Object.values(getDialectTables(dialect));
        const registry = t.getService(
          "schemaRegistry" as keyof ServiceMap
        ) as unknown as { getTable(name: string): unknown };

        for (const table of EXTENDABLE_CORE_TABLES) {
          await sql(`UPDATE ${table} SET leak_probe = '${SENTINEL}'`);
          // The control: the column is live and holds the sentinel.
          expect(
            serialised(await sql(`SELECT * FROM ${table}`)),
            table
          ).toContain(SENTINEL);

          const fromBundle = bundle.find(
            candidate => isTable(candidate) && getTableName(candidate) === table
          );
          expect(fromBundle, table).toBeDefined();
          // `id` present, so an empty column list cannot pass as a clean one.
          expect(columnNames(fromBundle), table).toContain("id");
          expect(columnNames(fromBundle), table).not.toContain("leak_probe");

          const fromRegistry = registry.getTable(table);
          expect(fromRegistry, table).toBeTruthy();
          expect(columnNames(fromRegistry), table).toContain("id");
          expect(columnNames(fromRegistry), table).not.toContain("leak_probe");

          const rows = await t.adapter.select<Record<string, unknown>>(table);
          expect(rows.length, table).toBeGreaterThan(0);
          expectNoHiddenColumn(serialised(rows));
        }
      });
    });
  }
);
