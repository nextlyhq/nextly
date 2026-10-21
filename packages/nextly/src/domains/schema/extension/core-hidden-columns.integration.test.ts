/**
 * A hidden column a schema hook contributes to a core table stays out of every
 * public read and write of that table's records, and the core's own writes
 * keep working once it is added. The five tables a hook may extend are each
 * covered: `users` and `media` through REST, the Direct API, and a
 * relationship or upload field that populates them; `nextly_jobs` and
 * `activity_log` through the one route each that lists their rows; and
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { createMediaHandlers } from "../../../api/media-handlers";
import { defineCollection, relationship, text, upload } from "../../../config";
import type { ServiceMap } from "../../../di/register";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { buildAuditLogWriter } from "../../audit/audit-log-writer";

import { col } from "./dsl";

/** What the hidden column holds. Searched for in every response. */
const SENTINEL = "hidden-sentinel-7f3a";
/** What each write tries to put there. Must never reach the table. */
const ATTEMPT = "written-through-api-9c1e";

const hiddenColumns = { leakProbe: col.text({ nullable: true }) };

/** Every core table a hook may extend. */
const CORE_TARGETS = [
  "users",
  "media",
  "nextly_jobs",
  "audit_log",
  "activity_log",
] as const;

const contributor = definePlugin({
  name: "@test/leak-probe",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          for (const table of CORE_TARGETS) {
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
    findByID(a: Record<string, unknown>): Promise<unknown>;
    update(a: Record<string, unknown>): Promise<unknown>;
  };
  media: {
    find(a?: Record<string, unknown>): Promise<unknown>;
    findByID(a: Record<string, unknown>): Promise<unknown>;
    update(a: Record<string, unknown>): Promise<unknown>;
  };
  jobs: {
    queue(a: Record<string, unknown>): Promise<{ id: string }>;
  };
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
      table: (typeof CORE_TARGETS)[number],
      column: string,
      value: string
    ): Promise<unknown[]> {
      const rows = await sql(
        `SELECT leak_probe FROM ${table} WHERE ${column} = '${value}'`
      );
      return rows.map(row => row.leak_probe ?? null);
    }

    /** The response, serialised, so the sentinel is found under any key. */
    function serialised(value: unknown): string {
      return JSON.stringify(value);
    }

    function rest(
      method: "GET" | "POST" | "PATCH",
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
      method: "GET" | "PATCH",
      path: string[],
      body?: unknown
    ) {
      // The admin mount: authenticated, and serving writes as well as reads.
      const handlers = createMediaHandlers({ requireAuth: true });
      return handlers[method](
        new Request(`http://localhost/api/media/${path.join("/")}`, {
          method,
          headers: {
            ...headers,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
      for (const table of CORE_TARGETS) {
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

    it("the search finds the sentinel in a read that does return the column", async () => {
      // The positive control for every read below: a whole-row read of the
      // live table carries the column, and the same search reports it. A
      // search that could not see the column would pass every read for the
      // wrong reason.
      for (const table of ["users", "media"] as const) {
        expect(serialised(await sql(`SELECT * FROM ${table}`))).toContain(
          SENTINEL
        );
      }
    });

    describe("users", () => {
      it("Direct API find", async () => {
        const out = serialised(await direct.users.find({ limit: 50 }));
        expect(out).toContain("member@example.com");
        expect(out).not.toContain(SENTINEL);
      });

      it("Direct API findByID", async () => {
        const out = serialised(await direct.users.findByID({ id: memberId }));
        expect(out).toContain("member@example.com");
        expect(out).not.toContain(SENTINEL);
      });

      it("REST list", async () => {
        const out = await bodyOf(await rest("GET", ["users"]));
        expect(out).toContain("member@example.com");
        expect(out).not.toContain(SENTINEL);
      });

      it("REST by id", async () => {
        const out = await bodyOf(await rest("GET", ["users", memberId]));
        expect(out).toContain("member@example.com");
        expect(out).not.toContain(SENTINEL);
      });

      it("REST me", async () => {
        const out = await bodyOf(await rest("GET", ["me"]));
        expect(out).toContain("owner@example.com");
        expect(out).not.toContain(SENTINEL);
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
        expect(viaDirect).not.toContain(SENTINEL);

        const viaRest = await bodyOf(
          await rest("GET", ["collections", "posts", "entries", postId])
        );
        expect(viaRest).toContain("member@example.com");
        expect(viaRest).not.toContain(SENTINEL);
      });

      it("Direct API update cannot set it", async () => {
        const out = serialised(
          await direct.users.update({
            id: memberId,
            data: { name: "Member 2", leakProbe: ATTEMPT, leak_probe: ATTEMPT },
          })
        );
        expect(out).toContain("Member 2");
        expect(out).not.toContain(ATTEMPT);
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
        expect(out).not.toContain(ATTEMPT);
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
        expect(out).not.toContain(ATTEMPT);
        expect(await stored("users", ownerId)).toBe(SENTINEL);
      });

      it("Direct API and REST create cannot set it, and the create succeeds", async () => {
        const created = await direct.users.create({
          email: "direct-new@example.com",
          password: "Password123!",
          data: { name: "New", leakProbe: ATTEMPT, leak_probe: ATTEMPT },
        });
        expect(serialised(created)).not.toContain(ATTEMPT);
        expect(await stored("users", created.item.id)).toBeNull();

        const res = await rest("POST", ["users"], {
          email: "rest-new@example.com",
          password: "Password123!",
          name: "Rest New",
          leakProbe: ATTEMPT,
          leak_probe: ATTEMPT,
        });
        const out = await bodyOf(res);
        expect(out).not.toContain(ATTEMPT);
        const rows = await sql(
          `SELECT leak_probe FROM users WHERE email = 'rest-new@example.com'`
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.leak_probe ?? null).toBeNull();
      });
    });

    describe("media", () => {
      it("Direct API find and findByID", async () => {
        const list = serialised(await direct.media.find({ limit: 50 }));
        expect(list).toContain("probe.pdf");
        expect(list).not.toContain(SENTINEL);

        const one = serialised(await direct.media.findByID({ id: mediaId }));
        expect(one).toContain("probe.pdf");
        expect(one).not.toContain(SENTINEL);
      });

      it("REST list and by id", async () => {
        const list = await bodyOf(await mediaRest("GET", []));
        expect(list).toContain("probe.pdf");
        expect(list).not.toContain(SENTINEL);

        const one = await bodyOf(await mediaRest("GET", [mediaId]));
        expect(one).toContain("probe.pdf");
        expect(one).not.toContain(SENTINEL);
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
        expect(viaDirect).not.toContain(SENTINEL);

        const viaRest = await bodyOf(
          await rest("GET", ["collections", "posts", "entries", postId])
        );
        expect(viaRest).toContain("probe.pdf");
        expect(viaRest).not.toContain(SENTINEL);
      });

      it("Direct API update cannot set it", async () => {
        const out = serialised(
          await direct.media.update({
            id: mediaId,
            data: { altText: "alt 1", leakProbe: ATTEMPT, leak_probe: ATTEMPT },
          })
        );
        expect(out).toContain("alt 1");
        expect(out).not.toContain(ATTEMPT);
        expect(out).not.toContain(SENTINEL);
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
        expect(out).not.toContain(ATTEMPT);
        expect(out).not.toContain(SENTINEL);
        expect(await stored("media", mediaId)).toBe(SENTINEL);
      });
    });

    describe("nextly_jobs", () => {
      it("the queue's own write succeeds, and the jobs list never returns it", async () => {
        const queued = await direct.jobs.queue({
          task: "leak-probe.sweep",
          input: { pass: 1 },
        });
        // The core's write, after the column was added: one row, the hidden
        // column untouched.
        expect(await storedBy("nextly_jobs", "id", queued.id)).toEqual([null]);

        await sql(`UPDATE nextly_jobs SET leak_probe = '${SENTINEL}'`);
        expect(serialised(await sql("SELECT * FROM nextly_jobs"))).toContain(
          SENTINEL
        );
        const out = await bodyOf(await rest("GET", ["jobs"]));
        expect(out).toContain("leak-probe.sweep");
        expect(out).not.toContain(SENTINEL);
      });
    });

    describe("activity_log", () => {
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
        expect(out).not.toContain(SENTINEL);
      });
    });

    describe("audit_log", () => {
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
  }
);
