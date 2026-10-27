/**
 * Makes a user over HTTP and signs them in, handing back their session.
 *
 * Three callers need a person other than the seeded dev user: a role holding
 * only the permissions a test names (`./limited-user`), a second editor beside
 * the first (`builder-lock.spec.ts`), and each spec file's own account
 * (`./test`). They share these steps, so they live here once.
 *
 * Two server rules shape them:
 *
 * - A password an admin types for someone else must be changed at first
 *   sign-in, so login answers with a pending token rather than a session, and
 *   a second call sets the user's own password and issues the session.
 * - The auth endpoints check a double-submit CSRF token AND the request's
 *   origin. Playwright's request client sends no `Origin`, so it is set here.
 *
 * With no trusted proxy, which is how the suite's server runs, the auth limit
 * counts per account rather than per address, so each new account signs in on
 * a budget of its own.
 *
 * @module tests/support/accounts
 */
import {
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

/** Typed by the admin for the new user; replaced at first sign-in. */
const TEMPORARY_PASSWORD = "Temporary-Pass-1";
/** Must differ from the temporary one, or the change is refused as a reuse. */
const OWN_PASSWORD = "Own-Password-2";

/** A signed-in session, as a browser context or request context opens with. */
export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface SignedInUser {
  storageState: StorageState;
  email: string;
  userId: string;
}

/** A tag unique enough that two workers never pick the same address. */
export function uniqueTag(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The id of the super-admin role, which holds every permission. */
export async function superAdminRoleId(
  admin: APIRequestContext
): Promise<string> {
  // `limit`, not a page size: the roles list reads only `limit` and `page`,
  // and super-admin sorts last.
  const roles = await admin.get("/admin/api/roles?limit=100");
  expect(roles.ok(), await roles.text()).toBe(true);
  const { items } = (await roles.json()) as {
    items: { id: string; slug: string }[];
  };
  const found = items.find(role => role.slug === "super-admin");
  if (!found) throw new Error("[e2e] No super-admin role to grant.");
  return found.id;
}

export async function createSignedInUser(
  /** A request context signed in as a super-admin, to create the user. */
  admin: APIRequestContext,
  baseURL: string,
  user: { email: string; name: string; roleIds: readonly string[] }
): Promise<SignedInUser> {
  const created = await admin.post("/admin/api/users", {
    data: {
      email: user.email,
      name: user.name,
      password: TEMPORARY_PASSWORD,
      roles: user.roleIds,
      isActive: true,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const userId = ((await created.json()) as { item: { id: string } }).item.id;

  const storageState = await withFreshSession(
    baseURL,
    async (api, csrfToken) => {
      const headers = { Origin: baseURL };
      const login = await api.post("/admin/api/auth/login", {
        headers,
        data: {
          email: user.email,
          password: TEMPORARY_PASSWORD,
          csrfToken: await csrfToken(),
        },
      });
      expect(login.status(), await login.text()).toBe(200);
      const pending = (await login.json()) as {
        status?: string;
        pendingToken?: string;
      };
      expect(pending.status).toBe("password_change_required");

      const changed = await api.post("/admin/api/auth/set-initial-password", {
        headers,
        data: {
          pendingToken: pending.pendingToken,
          newPassword: OWN_PASSWORD,
          csrfToken: await csrfToken(),
        },
      });
      expect(changed.status(), await changed.text()).toBe(200);
    },
    user.email
  );
  return { storageState, email: user.email, userId };
}

/**
 * Runs `signIn` in a request context with an empty jar, so nothing of any
 * other session comes along, then checks the session it left is `email`'s and
 * hands it back.
 */
async function withFreshSession(
  baseURL: string,
  signIn: (
    api: APIRequestContext,
    csrfToken: () => Promise<string>
  ) => Promise<void>,
  email: string
): Promise<StorageState> {
  const api = await request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    await signIn(
      api,
      async () =>
        (
          (await (await api.get("/admin/api/auth/csrf")).json()) as {
            token: string;
          }
        ).token
    );
    // Dev auto-login issues the dev user's session to any visit WITHOUT a
    // valid one, so a sign-in that quietly failed would leave a session that
    // is someone else's. Asking whose it is turns that into a failure here.
    const session = await api.get("/admin/api/auth/session");
    expect(session.ok(), await session.text()).toBe(true);
    const { user } = (await session.json()) as { user?: { email?: string } };
    expect(user?.email).toBe(email);
    return await api.storageState();
  } finally {
    await api.dispose();
  }
}
