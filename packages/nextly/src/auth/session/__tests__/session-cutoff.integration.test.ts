/**
 * An access token issued before its account was deactivated, or before an
 * administrator set its password, stops working at every place a session is
 * read, within the bound the documentation states.
 *
 * Each token here is a real one: signed by the login endpoint, or by the
 * Direct API's `nextly.login()`, whose token lives thirty days and is the
 * longest a cut-off has to reach. Each change is made the way an
 * administrator makes it, and each place is the production function a
 * request reaches, so a place that skips the check fails here by name.
 */

// The handlers sign with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { COOKIE_NAMES } from "../../cookies/cookie-config";
import { requireAuth } from "../../guards/require-auth";
import { buildAuthRouterDeps } from "../../handlers/deps-bridge";
import { handleLogin } from "../../handlers/login";
import { handleSession } from "../../handlers/session";
import { isErrorResponse, requireAuthentication } from "../../middleware/index";
import { hashPassword } from "../../password/index";
import { createPluginAuthApi } from "../../plugin-auth-api";
import { getSession } from "../get-session";
import {
  SESSION_CUTOFF_SECONDS,
  resetSessionStandingForTests,
} from "../session-standing";

const SECRET = process.env.NEXTLY_SECRET;
const ORIGIN = "http://localhost:3000";
const EMAIL = "cutoff@example.com";
const PASSWORD = "Str0ng-P@ssw0rd!";

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/** A clock the session check reads, moved by the test rather than by waiting. */
function testClock() {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    passTheBound: () => {
      offset += SESSION_CUTOFF_SECONDS * 1000;
    },
  };
}

type Deps = ReturnType<typeof buildAuthRouterDeps>;

interface Signed {
  t: TestNextly;
  userId: string;
  deps: Deps;
}

describe.each(getConfiguredTestDialects())(
  "an access token issued before an account change (%s)",
  (dialect: TestDialect) => {
    async function signedUp(): Promise<Signed> {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (dialect === "sqlite") {
        for (const statement of generateSqliteCoreTableStatements()) {
          await current.adapter.executeQuery(statement);
        }
      }
      const users = new ServiceContainer(current.adapter).users;
      // The install's first account is made its super-admin, which may not be
      // deactivated while it is the only one. The account under test is
      // another, so a deactivation here is the write this file is about. No
      // place read below depends on the account's role.
      await users.createLocalUser({
        email: "owner@example.com",
        name: "Owner",
        password: PASSWORD,
        isActive: true,
        emailVerification: "admin-vouched",
      });
      const created = await users.createLocalUser({
        email: EMAIL,
        name: "Cutoff",
        password: PASSWORD,
        isActive: true,
        emailVerification: "admin-vouched",
      });
      const deps = buildAuthRouterDeps(
        current.getService as unknown as (name: string) => unknown
      );
      return { t: current, userId: String(created.id), deps };
    }

    /** The session cookie a browser holds after signing in at the endpoint. */
    async function loginToken({ deps }: Signed): Promise<string> {
      const res = await handleLogin(
        new Request(`${ORIGIN}/admin/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: ORIGIN,
            cookie: "nextly_csrf=tok",
          },
          body: JSON.stringify({
            csrfToken: "tok",
            email: EMAIL,
            password: PASSWORD,
          }),
        }),
        deps
      );
      expect(res.status).toBe(200);
      const cookie = res.headers
        .getSetCookie()
        .find(c => c.startsWith(`${COOKIE_NAMES.accessToken}=`));
      expect(cookie).toBeDefined();
      return decodeURIComponent(
        String(cookie).split(";")[0].split("=").slice(1).join("=")
      );
    }

    /** The thirty-day token trusted server code gets from the Direct API. */
    async function directApiToken({ t }: Signed): Promise<string> {
      const { token } = await t.nextly.login({
        email: EMAIL,
        password: PASSWORD,
      });
      return token;
    }

    function carrying(token: string, path: string): Request {
      return new Request(`${ORIGIN}${path}`, {
        headers: { cookie: `${COOKIE_NAMES.accessToken}=${token}` },
      });
    }

    /**
     * Every place a request's session is read, each answering whether the
     * token was taken as a signed-in person. `GET /api/auth/state` asks the
     * same check before its own account read, which reaches the database
     * through `getCachedNextly()` rather than this harness's instance; its
     * refusal is covered by `api/__tests__/auth-state-session-ended.test.ts`.
     */
    const PLACES: Record<
      string,
      (token: string, s: Signed) => Promise<boolean>
    > = {
      getSession: async token =>
        (await getSession(carrying(token, "/admin/api/x"), SECRET))
          .authenticated,
      requireAuth: token =>
        requireAuth(carrying(token, "/admin/api/x"), SECRET).then(
          () => true,
          (error: unknown) => {
            if (NextlyError.isCode(error, "AUTH_REQUIRED")) return false;
            throw error;
          }
        ),
      "the API's authentication middleware": async token =>
        !isErrorResponse(
          await requireAuthentication(carrying(token, "/admin/api/x"))
        ),
      "GET /auth/session": async (token, { deps }) =>
        (await handleSession(carrying(token, "/admin/api/auth/session"), deps))
          .status === 200,
      "ctx.auth.currentUser": async (token, { deps }) =>
        (await createPluginAuthApi(() => deps).currentUser(
          carrying(token, "/admin/api/plugins/p/x")
        )) !== null,
    };

    /** Which places took the token, by name, so a failure names the place. */
    async function admittedAt(token: string, s: Signed) {
      const out: Record<string, boolean> = {};
      for (const [name, place] of Object.entries(PLACES)) {
        out[name] = await place(token, s);
      }
      return out;
    }

    const everywhere = (admitted: boolean) =>
      Object.fromEntries(Object.keys(PLACES).map(name => [name, admitted]));

    const CHANGES: Record<string, (s: Signed) => Promise<unknown>> = {
      "the account is deactivated": ({ t, userId }) =>
        t.nextly.users.update({ id: userId, data: { isActive: false } }),
      "an administrator sets its password": ({ t, userId }) =>
        t.nextly.users.update({
          id: userId,
          data: { password: "N3w-Str0ng-P@ss!" },
        }),
      "an administrator sets its password hash": async ({ t, userId }) =>
        new ServiceContainer(t.adapter).users.updatePasswordHash(
          userId,
          await hashPassword("N3w-Str0ng-P@ss!")
        ),
    };

    const SOURCES = {
      "the login endpoint": loginToken,
      "nextly.login()": directApiToken,
    };

    describe.each(Object.entries(CHANGES))("when %s", (_change, change) => {
      it.each(Object.entries(SOURCES))(
        "a token from %s is refused everywhere once the bound has passed",
        async (_source, issue) => {
          const s = await signedUp();
          const clock = testClock();
          resetSessionStandingForTests({ now: clock.now });
          const token = await issue(s);
          // The control: the same token, before the change, is a session at
          // every place, so a refusal below is the change's doing.
          expect(await admittedAt(token, s)).toEqual(everywhere(true));

          await change(s);
          clock.passTheBound();

          expect(await admittedAt(token, s)).toEqual(everywhere(false));
        }
      );
    });

    it("keeps a token issued before a deactivation refused after the account is reactivated", async () => {
      // Reactivating clears the deactivation, so a check that only read
      // whether the account is active would let the thirty-day token back in.
      const s = await signedUp();
      const clock = testClock();
      resetSessionStandingForTests({ now: clock.now });
      const before = await directApiToken(s);

      await CHANGES["the account is deactivated"](s);
      await s.t.nextly.users.update({ id: s.userId, data: { isActive: true } });
      clock.passTheBound();

      expect(await admittedAt(before, s)).toEqual(everywhere(false));
      // A sign-in after the change is a session again.
      expect(await admittedAt(await directApiToken(s), s)).toEqual(
        everywhere(true)
      );
    });

    it("signs in afresh with the password an administrator set", async () => {
      const s = await signedUp();
      await CHANGES["an administrator sets its password"](s);

      const { token } = await s.t.nextly.login({
        email: EMAIL,
        password: "N3w-Str0ng-P@ss!",
      });

      expect(await admittedAt(token, s)).toEqual(everywhere(true));
    });

    it("leaves the token working after an edit that ends no session", async () => {
      // The control for the change cases: refusing after every update would
      // satisfy them and sign out anyone whose name was edited.
      const s = await signedUp();
      const clock = testClock();
      resetSessionStandingForTests({ now: clock.now });
      const token = await loginToken(s);

      await s.t.nextly.users.update({
        id: s.userId,
        data: { name: "Renamed" },
      });
      clock.passTheBound();

      expect(await admittedAt(token, s)).toEqual(everywhere(true));
    });

    it("refuses at once on the instance that made the change", async () => {
      // No clock moves: the instance that deactivated the account stops
      // answering from what it had cached as soon as the write is made.
      const s = await signedUp();
      const token = await loginToken(s);
      expect(await admittedAt(token, s)).toEqual(everywhere(true));

      await CHANGES["the account is deactivated"](s);

      expect(await admittedAt(token, s)).toEqual(everywhere(false));
    });

    it("sees a change another instance made within the bound", async () => {
      // Another instance's write reaches this one only through the database,
      // so the cache's lifetime is the bound. The write is made the way that
      // instance makes it, as a raised epoch on the row, without the local
      // eviction this process would do for a change of its own.
      const s = await signedUp();
      const clock = testClock();
      resetSessionStandingForTests({ now: clock.now });
      const token = await loginToken(s);
      expect(await admittedAt(token, s)).toEqual(everywhere(true));

      const { users } = getDialectTables(dialect);
      const db = s.t.adapter.getDrizzle() as unknown as {
        update(table: unknown): {
          set(values: Record<string, unknown>): {
            where(condition: unknown): Promise<unknown>;
          };
        };
      };
      await db
        .update(users)
        .set({ sessionEpoch: 1 })
        .where(eq(users.id, s.userId));
      clock.passTheBound();

      expect(await admittedAt(token, s)).toEqual(everywhere(false));
    });
  }
);
