/**
 * The Team card's people on every dialect, asked through the real
 * `POST /api/dashboard/query` and offered through the real
 * `GET /api/dashboard/layout`, as three readers: a super-admin, an editor who
 * may read users and an author who may not.
 *
 * What only a database shows: that the list is filtered by role, ordered by
 * last active and cut in SQL on each dialect; that last active is the later of
 * a person's newest session renewal and newest sign-in, each read with its
 * column's own decoding; that a lapsed role assignment neither names a
 * person's role nor puts them under that role; and that the answer carries the
 * card's fields alone.
 *
 * @module services/dashboard/__tests__/team-people.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { WidgetLayoutService } from "../../../services/widgets/widget-layout-service";

const TEAM = "core/team";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Now, to the second, so MySQL's DATETIME holds each instant exactly. */
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
/** `minutes` before now. */
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

interface Inserts {
  insert(table: unknown): { values(row: unknown): Promise<unknown> };
  select(fields: unknown): {
    from(table: unknown): Promise<Record<string, unknown>[]>;
  };
}

/** One card's slot in the batch's answer. */
interface Slot {
  ok: boolean;
  code?: string;
  result?: { data?: { people: Record<string, unknown>[]; total: number } };
}

describe.each(getConfiguredTestDialects())(
  "Team's people (integration, %s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    const ids: Record<string, string> = {};

    const db = () => handle.adapter.getDrizzle() as unknown as Inserts;
    const tables = () => getDialectTables(handle.adapter.dialect);

    async function account(key: string, name: string): Promise<string> {
      const nextly = handle.nextly as unknown as {
        users: {
          create: (a: { data: Record<string, unknown> }) => Promise<{
            item: { id: string };
          }>;
        };
      };
      const created = await nextly.users.create({
        data: {
          email: `tp-${key}@example.test`,
          password: "Password123!",
          name,
          isActive: true,
        },
      });
      ids[key] = created.item.id;
      return created.item.id;
    }

    /** Gives `userId` the role `slug`, until `expiresAt` when given. */
    async function assign(
      userId: string,
      slug: string,
      expiresAt?: Date
    ): Promise<void> {
      const { roles } = tables();
      const rows = await db()
        .select({ id: roles.id, slug: roles.slug })
        .from(roles);
      const role = rows.find(row => row.slug === slug);
      if (role === undefined) throw new Error(`no role ${slug}`);
      await db()
        .insert(tables().userRoles)
        .values({
          id: randomUUID(),
          userId,
          roleId: role.id,
          createdAt: ago(60 * 24 * 30),
          ...(expiresAt === undefined ? {} : { expiresAt }),
        });
    }

    /** A session renewed for `userId` at `at`, as a refresh row records it. */
    async function renewed(userId: string, at: Date): Promise<void> {
      await db()
        .insert(tables().refreshTokens)
        .values({
          id: randomUUID(),
          userId,
          tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          expiresAt: new Date(at.getTime() + 7 * 24 * 60 * 60_000),
          createdAt: at,
        });
    }

    /** A sign-in by `userId` at `at`, as the audit trail records it. */
    async function signedIn(userId: string, at: Date): Promise<void> {
      await db().insert(tables().auditLog).values({
        id: randomUUID(),
        kind: "login-succeeded",
        actorUserId: userId,
        targetUserId: userId,
        createdAt: at,
      });
    }

    async function cookie(userId: string): Promise<string> {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.test`,
          name: userId,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return `nextly_session=${token}`;
    }

    /** Stores `userId`'s dashboard: one Team card with `config`. */
    async function place(
      userId: string,
      config: Record<string, unknown>,
      version: number
    ): Promise<number> {
      return new WidgetLayoutService(handle.adapter, silent).saveLayout(
        "user",
        userId,
        [{ id: "team", widgetId: TEAM, w: 6, h: 5, removed: false, config }],
        version
      );
    }

    /** The Team card's slot for `userId`, with `config` stored on it. */
    const versions = new Map<string, number>();
    async function card(
      userId: string,
      config: Record<string, unknown> = {}
    ): Promise<Slot> {
      versions.set(userId, await place(userId, config, versions.get(userId) ?? 0));
      const res = await createDynamicHandlers().POST(
        new Request("http://localhost/api/dashboard/query", {
          method: "POST",
          headers: {
            cookie: await cookie(userId),
            "content-type": "application/json",
          },
          body: JSON.stringify({ queries: [{ widget: TEAM, card: "team" }] }),
        }),
        { params: Promise.resolve({ params: ["dashboard", "query"] }) }
      );
      expect(res.status).toBe(200);
      const { results } = (await res.json()) as { results: Slot[] };
      return results[0]!;
    }

    /** Whether the Team widget is offered to `userId`. */
    async function offered(userId: string): Promise<boolean> {
      const res = await createDynamicHandlers().GET(
        new Request("http://localhost/api/dashboard/layout", {
          headers: { cookie: await cookie(userId) },
        }),
        { params: Promise.resolve({ params: ["dashboard", "layout"] }) }
      );
      expect(res.status).toBe(200);
      const layout = (await res.json()) as { widgets: Record<string, unknown> };
      return TEAM in layout.widgets;
    }

    const names = (slot: Slot) =>
      (slot.result?.data?.people ?? []).map(person => person.name);

    beforeAll(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
      });
      // The first account of an instance is its super-admin.
      await account("boss", "Boss");
      await account("edi", "Edi");
      await account("aut", "Aut");
      await account("ana", "Ana");
      await account("omar", "Omar");
      await account("lapsed", "Lapsed");
      await account("nobody", "Nobody");

      // The editor may read users; the author holds the preset alone, which may not.
      await assign(ids.edi!, "editor");
      await grantTo(handle, ids.edi!, "read", ["users"]);
      await assign(ids.aut!, "author");
      await assign(ids.ana!, "editor");
      await assign(ids.omar!, "author");
      // An editor until yesterday: no longer one.
      await assign(ids.lapsed!, "editor", ago(60 * 24));

      // Ana renewed her session ten minutes ago.
      await renewed(ids.ana!, ago(10));
      await signedIn(ids.ana!, ago(60 * 24 * 3));
      // Omar signed in two hours ago, after his last renewal a day ago.
      await renewed(ids.omar!, ago(60 * 24));
      await signedIn(ids.omar!, ago(120));
      // Lapsed was active most recently of all.
      await renewed(ids.lapsed!, ago(5));
      // Edi signed in a week ago and has no session left.
      await signedIn(ids.edi!, ago(60 * 24 * 7));
    }, 180_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it("lists everyone for a super-admin, most recently active first, with the card's fields alone", async () => {
      const slot = await card(ids.boss!);
      expect(slot.ok).toBe(true);
      const data = slot.result?.data;
      console.log("DEBUGTP", JSON.stringify(data));
      // Known last active first, newest first; then the rest by name.
      expect(names(slot)).toEqual(["Lapsed", "Ana", "Omar", "Edi", "Aut"]);
      expect(data?.total).toBe(7);
      expect(data?.people[0]).toEqual({
        name: "Lapsed",
        email: "tp-lapsed@example.test",
        lastActiveAt: ago(5).toISOString(),
      });
      expect(data?.people[1]).toEqual({
        name: "Ana",
        email: "tp-ana@example.test",
        role: "Editor",
        lastActiveAt: ago(10).toISOString(),
      });
      // The later of the two readings: the sign-in, after the renewal.
      expect(data?.people[2]).toMatchObject({
        name: "Omar",
        role: "Author",
        lastActiveAt: ago(120).toISOString(),
      });
      // Nothing about a person the card does not draw.
      for (const person of data?.people ?? []) {
        for (const key of Object.keys(person)) {
          expect(["name", "email", "role", "lastActiveAt"]).toContain(key);
        }
      }
    });

    it("cuts the list at its Number of people, and still counts everyone", async () => {
      const slot = await card(ids.boss!, { limit: 10 });
      expect(names(slot)).toEqual([
        "Lapsed",
        "Ana",
        "Omar",
        "Edi",
        "Aut",
        "Boss",
        "Nobody",
      ]);
      const two = await card(ids.boss!, { limit: 2 });
      expect(names(two)).toEqual(["Lapsed", "Ana"]);
      expect(two.result?.data?.total).toBe(7);
    });

    it("filters by role in the database, leaving out a role that has lapsed", async () => {
      const editors = await card(ids.boss!, { role: "editor", limit: 10 });
      expect(names(editors)).toEqual(["Ana", "Edi"]);
      expect(editors.result?.data?.total).toBe(2);
      // Edi holds a role of her own beside Editor: under this filter, Editor is the one named.
      expect(editors.result?.data?.people[1]).toMatchObject({
        name: "Edi",
        role: "Editor",
      });
      const authors = await card(ids.boss!, { role: "author" });
      expect(names(authors)).toEqual(["Omar", "Aut"]);
      const admins = await card(ids.boss!, { role: "admin" });
      expect(admins.result?.data).toEqual({ people: [], total: 0 });
    });

    it("answers an editor who may read users, and offers them the card", async () => {
      expect(await offered(ids.edi!)).toBe(true);
      const slot = await card(ids.edi!, { role: "editor" });
      expect(slot.ok).toBe(true);
      expect(names(slot)).toEqual(["Ana", "Edi"]);
    });

    it("neither offers nor answers the card for an author who may not read users", async () => {
      expect(await offered(ids.aut!)).toBe(false);
      const slot = await card(ids.aut!);
      expect(slot).toMatchObject({ ok: false });
      expect(JSON.stringify(slot)).not.toContain("tp-ana@example.test");
      // The control: the super-admin is offered it.
      expect(await offered(ids.boss!)).toBe(true);
    });
  }
);
