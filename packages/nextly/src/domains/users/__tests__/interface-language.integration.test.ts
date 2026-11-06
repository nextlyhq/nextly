/**
 * Each signed-in user's own interface language, set through the self-profile
 * path and nowhere else, on every configured dialect.
 *
 * A user sets, reads back and clears their own through `PATCH /api/me` and
 * `GET /api/me`, and through the Direct API's `updateMe`. The request names no
 * user, so a choice only ever reaches the session's own row: one user's never
 * changes another's, and an administrator's `PATCH /users/:id` naming the key
 * is refused, naming it, and writes nothing, while their ordinary edit of the
 * same user still saves. A tag that is malformed or not spelled canonically is
 * refused, naming the field, before anything is written.
 *
 * Each refusal is asserted beside a write that is accepted in the same test,
 * so a path that wrote nothing at all would fail here rather than pass.
 *
 * @module domains/users/__tests__/interface-language.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

interface Direct {
  users: {
    create(a: Record<string, unknown>): Promise<{ item: { id: string } }>;
  };
  updateMe(a: Record<string, unknown>): Promise<unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a user's own interface language (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    let ownerId: string;
    let memberId: string;
    const cookies: Record<string, string> = {};

    /** A session cookie for `id`, as sign-in issues one. */
    async function sessionFor(
      id: string,
      email: string,
      name: string
    ): Promise<string> {
      const token = await signAccessToken(
        buildClaims({
          userId: id,
          email,
          name,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return `nextly_session=${token}`;
    }

    /** One REST call, signed in as `as`. */
    function rest(
      as: "owner" | "member",
      method: "GET" | "PATCH",
      path: string[],
      body?: unknown
    ): Promise<Response> {
      const handlers = createDynamicHandlers();
      return handlers[method](
        new Request(`http://localhost/api/${path.join("/")}`, {
          method,
          headers: {
            cookie: cookies[as]!,
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

    /** `GET /api/me`'s interface language, signed in as `as`. */
    async function ownLanguage(as: "owner" | "member"): Promise<unknown> {
      const res = await rest(as, "GET", ["me"]);
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("interfaceLanguage");
      return body.interfaceLanguage;
    }

    /** What is stored for `id`, read past every service. */
    async function stored(id: string): Promise<unknown> {
      const [row] = await t.adapter.select<Record<string, unknown>>("users", {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      return row?.interfaceLanguage;
    }

    /** The field a refusal names, from the canonical error envelope. */
    async function refusedField(res: Response): Promise<unknown> {
      const text = await res.text();
      expect(res.status, text).toBe(400);
      const body = JSON.parse(text) as {
        error?: { data?: { errors?: Array<{ path?: string }> } };
      };
      return body.error?.data?.errors?.map(error => error.path);
    }

    beforeAll(async () => {
      t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      direct = t.nextly as unknown as Direct;
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      // The install's first account is the owner; the second is an ordinary
      // one, whose own path is the one under test.
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
      cookies.owner = await sessionFor(ownerId, "owner@example.com", "Owner");
      cookies.member = await sessionFor(
        memberId,
        "member@example.com",
        "Member"
      );
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("a user sets, reads and clears their own interface language", async () => {
      expect(await ownLanguage("member")).toBeNull();

      const set = await rest("member", "PATCH", ["me"], {
        interfaceLanguage: "fr",
      });
      expect(set.status, await set.clone().text()).toBe(200);
      expect(await ownLanguage("member")).toBe("fr");
      expect(await stored(memberId)).toBe("fr");

      const cleared = await rest("member", "PATCH", ["me"], {
        interfaceLanguage: null,
      });
      expect(cleared.status, await cleared.clone().text()).toBe(200);
      expect(await ownLanguage("member")).toBeNull();
      expect(await stored(memberId)).toBeNull();
    });

    it("one user's choice never changes another's", async () => {
      await rest("member", "PATCH", ["me"], { interfaceLanguage: "de" });

      expect(await ownLanguage("member")).toBe("de");
      expect(await ownLanguage("owner")).toBeNull();
      expect(await stored(ownerId)).toBeNull();
    });

    it("an administrator's edit naming another user's interface language is refused, naming the field, and changes nothing", async () => {
      await rest("member", "PATCH", ["me"], { interfaceLanguage: "de" });

      expect(
        await refusedField(
          await rest("owner", "PATCH", ["users", memberId], {
            name: "Member Renamed",
            interfaceLanguage: "fr",
          })
        )
      ).toContain("interfaceLanguage");
      expect(await stored(memberId)).toBe("de");

      // The control: the same administrator's ordinary edit of that user
      // still saves, and still leaves their language alone.
      const renamed = await rest("owner", "PATCH", ["users", memberId], {
        name: "Member Renamed",
      });
      expect(renamed.status, await renamed.clone().text()).toBe(200);
      const [row] = await t.adapter.select<Record<string, unknown>>("users", {
        where: { and: [{ column: "id", op: "=", value: memberId }] },
      });
      expect(row?.name).toBe("Member Renamed");
      expect(await stored(memberId)).toBe("de");
    });

    it("a refused language leaves the row unchanged", async () => {
      await rest("member", "PATCH", ["me"], { interfaceLanguage: "es" });

      for (const language of ["pt-br", "english", "", 42]) {
        expect(
          await refusedField(
            await rest("member", "PATCH", ["me"], {
              interfaceLanguage: language,
            })
          ),
          String(language)
        ).toContain("interfaceLanguage");
      }
      expect(await stored(memberId)).toBe("es");

      // A canonical spelling of the same language is accepted.
      const accepted = await rest("member", "PATCH", ["me"], {
        interfaceLanguage: "pt-BR",
      });
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      expect(await stored(memberId)).toBe("pt-BR");
    });

    it("updateMe sets and clears the interface language", async () => {
      await direct.updateMe({
        user: { id: memberId },
        data: { interfaceLanguage: "it" },
      });
      expect(await stored(memberId)).toBe("it");

      await direct.updateMe({
        user: { id: memberId },
        data: { interfaceLanguage: null },
      });
      expect(await stored(memberId)).toBeNull();
    });
  }
);
