/**
 * The session's cookies as a browser holds and sends them.
 *
 * A cookie reaches a handler only when its `Path` covers the request's path,
 * so whether sign-out can delete the refresh row depends on where the cookie
 * was scoped, not on what the handler does with it. These tests keep a small
 * cookie jar that applies each response's `Set-Cookie` headers and sends back
 * only the cookies whose path matches, as a browser does, and drive the real
 * handlers and deps-bridge against the database.
 */

// The handlers sign with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { hashRefreshToken } from "../../session/refresh";
import { buildAuthRouterDeps } from "../deps-bridge";
import { handleLogin } from "../login";
import { handleLogout } from "../logout";
import { handleRefresh } from "../refresh";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ORIGIN = "http://localhost:3000";
const AUTH = `${ORIGIN}/admin/api/auth`;
const EMAIL = "jar@example.com";
const PASSWORD = "Str0ng-P@ssw0rd!";

interface StoredCookie {
  name: string;
  value: string;
  path: string;
}

/** A browser's cookie jar, reduced to name, value, `Path` and `Max-Age=0`. */
class CookieJar {
  private cookies: StoredCookie[] = [];

  set(name: string, value: string, path: string): void {
    this.cookies = this.cookies.filter(
      c => !(c.name === name && c.path === path)
    );
    this.cookies.push({ name, value, path });
  }

  /** Apply a response's Set-Cookie headers; `Max-Age=0` removes the cookie. */
  apply(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";").map(s => s.trim());
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = decodeURIComponent(pair.slice(at + 1));
      const attr = (key: string) =>
        attributes
          .find(a => a.toLowerCase().startsWith(`${key.toLowerCase()}=`))
          ?.split("=")[1];
      const path = attr("Path") ?? "/";
      if (attr("Max-Age") === "0") {
        this.cookies = this.cookies.filter(
          c => !(c.name === name && c.path === path)
        );
      } else {
        this.set(name, value, path);
      }
    }
  }

  /** The cookies a request to `url` carries: path-matched, longest first. */
  header(url: string): string {
    const requestPath = new URL(url).pathname;
    return this.cookies
      .filter(
        c =>
          requestPath === c.path ||
          requestPath.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`)
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map(c => `${c.name}=${encodeURIComponent(c.value)}`)
      .join("; ");
  }

  named(name: string): StoredCookie[] {
    return this.cookies.filter(c => c.name === name);
  }
}

describe.each(getConfiguredTestDialects())(
  "session cookies (%s)",
  (dialect: TestDialect) => {
    async function signedUp(): Promise<{
      t: TestNextly;
      userId: string;
      deps: ReturnType<typeof buildAuthRouterDeps>;
    }> {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (dialect === "sqlite") {
        for (const statement of generateSqliteCoreTableStatements()) {
          await current.adapter.executeQuery(statement);
        }
      }
      const created = await new ServiceContainer(
        current.adapter
      ).users.createLocalUser({
        email: EMAIL,
        name: "Jar",
        password: PASSWORD,
        isActive: true,
        emailVerification: "admin-vouched",
      });
      const deps = buildAuthRouterDeps(
        current.getService as unknown as (name: string) => unknown
      );
      return { t: current, userId: String(created.id), deps };
    }

    async function refreshRows(t: TestNextly, userId: string) {
      const { refreshTokens } = getDialectTables();
      const db = t.adapter.getDrizzle() as unknown as {
        select: () => {
          from: (table: unknown) => {
            where: (cond: unknown) => Promise<Array<{ tokenHash: string }>>;
          };
        };
      };
      return db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, userId));
    }

    function post(jar: CookieJar, path: string, body: object): Request {
      const url = `${AUTH}/${path}`;
      return new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          cookie: jar.header(url),
        },
        body: JSON.stringify({ csrfToken: "tok", ...body }),
      });
    }

    /** A browser that has fetched its CSRF token, as the admin does first. */
    function browser(): CookieJar {
      const jar = new CookieJar();
      jar.set("nextly_csrf", "tok", "/admin");
      return jar;
    }

    async function signIn(
      jar: CookieJar,
      deps: ReturnType<typeof buildAuthRouterDeps>
    ) {
      const res = await handleLogin(
        post(jar, "login", { email: EMAIL, password: PASSWORD }),
        deps
      );
      expect(res.status).toBe(200);
      jar.apply(res);
      return res;
    }

    /** The cookie a response sets under `name`, with its attributes. */
    function setCookie(res: Response, name: string): string {
      const found = res.headers
        .getSetCookie()
        .filter(c => c.startsWith(`${name}=`) && !c.includes("Max-Age=0"));
      expect(found).toHaveLength(1);
      return found[0];
    }

    function maxAge(cookie: string): number {
      return Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    }

    describe("lifetimes", () => {
      it.each(["login", "refresh"] as const)(
        "on %s: the access token ends after its own TTL, and both cookies last the refresh TTL",
        async step => {
          const { deps } = await signedUp();
          // The access token's lifetime is 15 minutes; the refresh token's is
          // longer, and the access cookie lives as long as the refresh token
          // so an expired access token still reaches the server, which
          // answers TOKEN_EXPIRED and so starts a refresh.
          expect(deps.accessTokenTTL).toBe(15 * 60);
          expect(deps.refreshTokenTTL).toBeGreaterThan(deps.accessTokenTTL);

          const jar = browser();
          let res = await signIn(jar, deps);
          if (step === "refresh") {
            res = await handleRefresh(post(jar, "refresh", {}), deps);
            expect(res.status).toBe(200);
          }

          const access = setCookie(res, "nextly_session");
          expect(maxAge(access)).toBe(deps.refreshTokenTTL);
          const claims = decodeJwt(
            decodeURIComponent(access.split(";")[0].split("=")[1])
          );
          expect(Number(claims.exp) - Number(claims.iat)).toBe(
            deps.accessTokenTTL
          );

          const refresh = setCookie(res, "nextly_refresh");
          expect(maxAge(refresh)).toBe(deps.refreshTokenTTL);
          expect(refresh).toContain("Path=/admin/api/auth;");
        }
      );
    });

    describe("sign-out from a browser", () => {
      it("deletes the refresh row of the session it ends", async () => {
        const { t, userId, deps } = await signedUp();
        const jar = browser();
        await signIn(jar, deps);
        expect(await refreshRows(t, userId)).toHaveLength(1);

        const res = await handleLogout(post(jar, "logout", {}), deps);
        jar.apply(res);

        expect(res.status).toBe(200);
        expect(await refreshRows(t, userId)).toHaveLength(0);
        expect(jar.named("nextly_refresh")).toEqual([]);
        expect(jar.named("nextly_session")).toEqual([]);
      });

      it("rotates with the cookie at its path, and the rotated row is the one sign-out deletes", async () => {
        const { t, userId, deps } = await signedUp();
        const jar = browser();
        await signIn(jar, deps);

        const rotated = await handleRefresh(post(jar, "refresh", {}), deps);
        expect(rotated.status).toBe(200);
        jar.apply(rotated);
        const rows = await refreshRows(t, userId);
        expect(rows).toHaveLength(1);
        const { refreshToken } = (await rotated.json()) as {
          refreshToken: string;
        };
        expect(rows[0].tokenHash).toBe(hashRefreshToken(refreshToken));

        await handleLogout(post(jar, "logout", {}), deps);
        expect(await refreshRows(t, userId)).toHaveLength(0);
      });

      it("clears the refresh cookie at both its path and the legacy one", async () => {
        const { deps } = await signedUp();
        const jar = browser();
        // A session signed in before the path widened, which never refreshed.
        jar.set("nextly_refresh", "legacy", "/admin/api/auth/refresh");

        const res = await handleLogout(post(jar, "logout", {}), deps);
        jar.apply(res);

        const cleared = res.headers
          .getSetCookie()
          .filter(
            c => c.startsWith("nextly_refresh=") && c.includes("Max-Age=0")
          );
        expect(cleared.map(c => /Path=([^;]+)/.exec(c)?.[1]).sort()).toEqual([
          "/admin/api/auth",
          "/admin/api/auth/refresh",
        ]);
        expect(jar.named("nextly_refresh")).toEqual([]);
      });
    });

    describe("a browser still holding the cookie at the legacy path", () => {
      it("rotates it, moving the cookie to the new path and clearing the old one", async () => {
        const { t, userId, deps } = await signedUp();
        const legacyToken = "legacy-refresh-token";
        const { refreshTokens } = getDialectTables();
        await (
          t.adapter.getDrizzle() as unknown as {
            insert: (table: unknown) => {
              values: (data: unknown) => Promise<unknown>;
            };
          }
        )
          .insert(refreshTokens)
          .values({
            id: "rt-legacy",
            userId,
            tokenHash: hashRefreshToken(legacyToken),
            userAgent: null,
            ipAddress: null,
            expiresAt: new Date(Date.now() + 3600 * 1000),
          });
        const jar = browser();
        jar.set("nextly_refresh", legacyToken, "/admin/api/auth/refresh");

        const res = await handleRefresh(post(jar, "refresh", {}), deps);
        expect(res.status).toBe(200);
        jar.apply(res);

        // One cookie under the name, at the new path: no copy left at the
        // legacy path to shadow it on the next refresh.
        expect(jar.named("nextly_refresh").map(c => c.path)).toEqual([
          "/admin/api/auth",
        ]);
        await handleLogout(post(jar, "logout", {}), deps);
        expect(await refreshRows(t, userId)).toHaveLength(0);
      });
    });
  }
);
