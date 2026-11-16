/**
 * Who a plugin route's write is recorded as, end to end through the real
 * catch-all dispatcher, on every configured dialect.
 *
 * A write a route makes as its own caller is recorded under the caller the
 * request authenticated as: the API key itself for a key, as a REST write by
 * the same key is, and the person for a session. Every trail that names an
 * actor says so alike: the content events, the document's changer columns,
 * the webhook outbox and the activity log. A write the route makes as the
 * system, or as somebody else, is recorded as before. And recording the key
 * grants it nothing: its write is still judged on its own scope.
 *
 * @module plugins/routes/__tests__/plugin-route-key-attribution.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  currentRequestCaller,
  currentRouteActor,
} from "../../../auth/caller-scope";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services";
import type { AuthUser } from "../../../types/auth";
import { definePlugin } from "../../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../test-nextly";

const PLUGIN = "@test/key-attribution";
const NOTES = "notes";

/** Set by each test before it calls the routes: the person "as another" names. */
let somebodyElse: AuthUser | undefined;

/**
 * Routes that rename a note three ways: as the request's own caller (the
 * shape every first-party route uses), as the system, and as somebody else.
 * Each says it overwrites, since what is under test is who is recorded, not
 * the version check.
 */
const writer = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        siteWide: false,
        method: "POST",
        path: "/as-caller",
        handler: async (req, ctx) => {
          const { id, title } = (await req.json()) as {
            id: string;
            title: string;
          };
          try {
            await ctx.services.collections.updateEntry(
              NOTES,
              id,
              { title, _overwrite: true },
              { as: "user", user: ctx.user ?? undefined }
            );
            return Response.json({ wrote: true });
          } catch (error) {
            return Response.json(
              { wrote: false, reason: String(error) },
              { status: 403 }
            );
          }
        },
      },
      {
        siteWide: false,
        method: "POST",
        path: "/scopes",
        // What the handler runs under: the actor its writes are recorded
        // as, and whether a REST caller is pinned, which would tell the
        // services a gate already ran for this request's writes.
        handler: () =>
          Response.json({
            routeActor: currentRouteActor()?.actor ?? null,
            requestCallerPinned: currentRequestCaller() !== undefined,
          }),
      },
      {
        siteWide: false,
        method: "POST",
        path: "/as-system",
        handler: async (req, ctx) => {
          const { id, title } = (await req.json()) as {
            id: string;
            title: string;
          };
          await ctx.services.collections.updateEntry(NOTES, id, {
            title,
            _overwrite: true,
          });
          return Response.json({ wrote: true });
        },
      },
      {
        siteWide: false,
        method: "POST",
        path: "/as-another",
        handler: async (req, ctx) => {
          const { id, title } = (await req.json()) as {
            id: string;
            title: string;
          };
          await ctx.services.collections.updateEntry(
            NOTES,
            id,
            { title, _overwrite: true },
            { as: "user", user: somebodyElse }
          );
          return Response.json({ wrote: true });
        },
      },
    ],
  },
});

function call(
  sub: "as-caller" | "as-system" | "as-another" | "scopes",
  headers: Record<string, string>,
  body: unknown
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const url = `http://localhost/api/plugins/${PLUGIN}/${sub}`;
  return handlers.POST(
    new Request(url, {
      method: "POST",
      headers: {
        ...headers,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({
        params: ["plugins", ...PLUGIN.split("/"), sub],
      }),
    }
  );
}

/** Who one trail recorded for the note's latest change. */
interface Recorded {
  readonly kind: string | null;
  readonly id: string | null;
}

/** What every actor-naming trail recorded for the note's latest update. */
interface Trails {
  readonly contentEvent: Recorded;
  readonly changer: Recorded;
  readonly webhook: Recorded;
  readonly activity: Recorded | null;
}

describe.each(getConfiguredTestDialects())(
  "who a plugin route's write is recorded as (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      somebodyElse = undefined;
    });

    async function boot(): Promise<TestNextly> {
      t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
        plugins: [writer],
      });
      // The first user is the install's super admin; made here and never
      // used, so every caller below holds only what it is granted.
      await person(t, "owner");
      return t;
    }

    async function person(handle: TestNextly, name: string): Promise<AuthUser> {
      const email = `${name}-${String(Date.now())}@example.com`;
      const made = await handle.nextly.users.create({
        email,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return { id: String(made.item.id) as AuthUser["id"], email, name };
    }

    /** A person holding exactly `slugs`. */
    async function holding(
      handle: TestNextly,
      name: string,
      slugs: readonly string[]
    ): Promise<AuthUser> {
      const who = await person(handle, name);
      const permissions = await handle.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await handle.nextly.roles.create({
        data: {
          name: `${name} role`,
          slug: `${name}-role`,
          permissionIds: ids,
        },
      });
      const assigned = await new ServiceContainer(
        handle.adapter
      ).userRoles.assignRoleToUser(who.id, String(role.item.id));
      expect(assigned.success).toBe(true);
      return who;
    }

    async function sessionOf(user: AuthUser): Promise<Record<string, string>> {
      const token = await signAccessToken(
        buildClaims({
          userId: user.id,
          email: user.email,
          name: user.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      const csrf = "c".repeat(64);
      return {
        cookie: `nextly_session=${token}; nextly_csrf=${csrf}`,
        "x-csrf-token": csrf,
      };
    }

    async function keyOf(
      handle: TestNextly,
      owner: AuthUser,
      tokenType: "full-access" | "read-only"
    ): Promise<{ headers: Record<string, string>; id: string }> {
      const made = await handle.nextly.apiKeys.create({
        userId: owner.id,
        name: `${tokenType} key`,
        tokenType,
        expiresIn: "unlimited",
      });
      return {
        headers: { authorization: `Bearer ${made.key}` },
        id: String(made.doc.id),
      };
    }

    async function note(handle: TestNextly): Promise<string> {
      const made = await handle.nextly.create({
        collection: NOTES,
        data: { title: "first" },
        overrideAccess: true,
      });
      return String(made.item.id);
    }

    /** The latest of `rows` by id, which every trail mints time-ordered. */
    function latest<T extends { id: string }>(rows: T[]): T | undefined {
      return [...rows].sort((a, b) => (a.id < b.id ? -1 : 1)).at(-1);
    }

    async function trails(handle: TestNextly, id: string): Promise<Trails> {
      const events = await handle.adapter.select<{
        id: string;
        subjectId: string;
        kind: string;
        actorKind: string;
        actorId: string | null;
      }>("nextly_content_events");
      const event = latest(
        events.filter(row => row.subjectId === id && row.kind !== "created")
      );
      const row = await handle.adapter.selectOne<Record<string, unknown>>(
        `dc_${NOTES}`,
        { where: { and: [{ column: "id", op: "=", value: id }] } }
      );
      const outbox = await handle.adapter.select<{
        id: string;
        type: string;
        resourceId: string | null;
        actorType: string | null;
        actorId: string | null;
      }>("nextly_events");
      const sent = latest(
        outbox.filter(
          entry => entry.resourceId === id && !entry.type.endsWith("created")
        )
      );
      const logged = await handle.adapter.select<{
        id: string;
        action: string;
        entryId: string | null;
        actorType: string | null;
        userId: string;
      }>("activity_log");
      const activity = latest(
        logged.filter(
          entry => entry.entryId === id && entry.action === "update"
        )
      );
      return {
        contentEvent: {
          kind: event?.actorKind ?? null,
          id: event?.actorId ?? null,
        },
        changer: {
          kind: (row?._changed_by_kind as string | null) ?? null,
          id: (row?._changed_by_id as string | null) ?? null,
        },
        webhook: { kind: sent?.actorType ?? null, id: sent?.actorId ?? null },
        activity:
          activity === undefined
            ? null
            : { kind: activity.actorType, id: activity.userId },
      };
    }

    const AUTHOR = ["read-notes", "update-notes"];

    it("records a key's write as the key on every trail, as REST does", async () => {
      const handle = await boot();
      const author = await holding(handle, "author", AUTHOR);
      const key = await keyOf(handle, author, "full-access");
      const id = await note(handle);

      const response = await call("as-caller", key.headers, {
        id,
        title: "by the key",
      });

      expect(response.status, await response.clone().text()).toBe(200);
      expect(await trails(handle, id)).toEqual({
        contentEvent: { kind: "apiKey", id: key.id },
        changer: { kind: "apiKey", id: key.id },
        webhook: { kind: "apiKey", id: key.id },
        activity: { kind: "apiKey", id: key.id },
      });

      // The same key through REST, as the reference: the two doors record
      // one write alike.
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      const rest = await handlers.PATCH!(
        new Request(`http://localhost/api/collections/${NOTES}/entries/${id}`, {
          method: "PATCH",
          headers: { ...key.headers, "content-type": "application/json" },
          body: JSON.stringify({
            title: "by the key, via REST",
            _overwrite: true,
          }),
        }),
        {
          params: Promise.resolve({
            params: ["collections", NOTES, "entries", id],
          }),
        }
      );
      expect(rest.status, await rest.clone().text()).toBe(200);
      expect((await trails(handle, id)).contentEvent).toEqual({
        kind: "apiKey",
        id: key.id,
      });
    });

    it("records a session's write as the person", async () => {
      const handle = await boot();
      const author = await holding(handle, "author", AUTHOR);
      const id = await note(handle);

      const response = await call("as-caller", await sessionOf(author), {
        id,
        title: "by the person",
      });

      expect(response.status, await response.clone().text()).toBe(200);
      const recorded = await trails(handle, id);
      expect(recorded.contentEvent).toEqual({ kind: "person", id: author.id });
      expect(recorded.changer).toEqual({ kind: "person", id: author.id });
      expect(recorded.webhook).toEqual({ kind: "user", id: author.id });
      expect(recorded.activity).toEqual({ kind: "user", id: author.id });
    });

    it("leaves a write as the system, or as somebody else, recorded as before", async () => {
      const handle = await boot();
      const author = await holding(handle, "author", AUTHOR);
      somebodyElse = await holding(handle, "editor", AUTHOR);
      const key = await keyOf(handle, author, "full-access");
      const id = await note(handle);

      // Made inside a key's request, so a pinned actor that leaked into
      // either write would show here as the key.
      const bySystem = await call("as-system", key.headers, {
        id,
        title: "by the system",
      });
      expect(bySystem.status).toBe(200);
      expect((await trails(handle, id)).contentEvent).toEqual({
        kind: "system",
        id: null,
      });

      const byAnother = await call("as-another", key.headers, {
        id,
        title: "for the editor",
      });
      expect(byAnother.status).toBe(200);
      const recorded = await trails(handle, id);
      expect(recorded.contentEvent).toEqual({
        kind: "person",
        id: somebodyElse.id,
      });
      expect(recorded.changer).toEqual({
        kind: "person",
        id: somebodyElse.id,
      });
    });

    it("still judges the key on its own scope: recording it admits nothing", async () => {
      const handle = await boot();
      const author = await holding(handle, "author", AUTHOR);
      const key = await keyOf(handle, author, "read-only");
      const id = await note(handle);

      const response = await call("as-caller", key.headers, {
        id,
        title: "a read-only key's write",
      });

      // The write is judged on the key's own scope, and refused.
      expect(response.status).toBe(403);
      const stored = await handle.nextly.findByID({
        collection: NOTES,
        id,
        overrideAccess: true,
      });
      expect((stored as { title?: unknown } | null)?.title).toBe("first");

      // And what the handler ran under: the actor, for attribution, and no
      // REST caller. A pinned `RequestCaller` is what tells a service that a
      // route's gate already ran for the write, so it skips its own; a plugin
      // route ran no gate for its handler's writes.
      const scopes = await call("scopes", key.headers, {});
      expect(await scopes.json()).toEqual({
        routeActor: { type: "apiKey", id: key.id },
        requestCallerPinned: false,
      });
    });
  }
);
