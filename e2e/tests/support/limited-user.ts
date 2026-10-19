import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";

/**
 * A browser signed in as someone other than the dev super-admin.
 *
 * The suite's own session is `dev@nextly.local`, who holds every permission,
 * so nothing it opens can ever be refused. This makes a role holding exactly
 * the permissions a test names, a user holding that role, and a fresh browser
 * context signed in as that user, all over HTTP: the playground renders no
 * sign-in page.
 *
 * Two server rules shape it:
 *
 * - A password an admin types for someone else must be changed at first
 *   sign-in, so login answers with a pending token rather than a session, and
 *   the second call sets the user's own password and issues the session.
 * - The auth endpoints check a double-submit CSRF token AND the request's
 *   origin. Playwright's request client sends no `Origin`, so it is set here.
 *
 * Login shares a per-address budget of attempts with the other auth POSTs, and
 * this spends two, so call it once per spec file, not once per test.
 */

/** Typed by the admin for the new user; replaced at first sign-in. */
const TEMPORARY_PASSWORD = "Temporary-Pass-1";
/** Must differ from the temporary one, or the change is refused as a reuse. */
const OWN_PASSWORD = "Own-Password-2";

export interface LimitedUser {
  context: BrowserContext;
  email: string;
  userId: string;
  roleId: string;
}

export async function signInAsLimitedUser(
  browser: Browser,
  /** A request context signed in as the super-admin, to create the role and user. */
  admin: APIRequestContext,
  baseURL: string,
  permissions: readonly string[]
): Promise<LimitedUser> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Roles take permission ids, not slugs. The list pages at ten by default,
  // which would silently miss most of them.
  const list = await admin.get("/admin/api/permissions?page=1&limit=1000");
  expect(list.ok(), await list.text()).toBe(true);
  const { items } = (await list.json()) as {
    items: Array<{ id: string; slug: string }>;
  };
  const permissionIds = permissions.map(slug => {
    const found = items.find(item => item.slug === slug);
    if (!found) throw new Error(`[e2e] No permission "${slug}" to grant.`);
    return found.id;
  });

  const role = await admin.post("/admin/api/roles", {
    data: {
      name: `E2E limited ${tag}`,
      slug: `e2e-limited-${tag}`,
      permissionIds,
    },
  });
  expect(role.status(), await role.text()).toBe(201);
  const roleId = ((await role.json()) as { item: { id: string } }).item.id;

  const email = `limited-${tag}@nextly.local`;
  const user = await admin.post("/admin/api/users", {
    data: {
      email,
      name: "Limited User",
      password: TEMPORARY_PASSWORD,
      roles: [roleId],
      isActive: true,
    },
  });
  expect(user.status(), await user.text()).toBe(201);
  const userId = ((await user.json()) as { item: { id: string } }).item.id;

  // An empty jar, so nothing of the super-admin's session comes along.
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const api = context.request;
  const headers = { Origin: baseURL };
  const csrfToken = async () =>
    (
      (await (await api.get("/admin/api/auth/csrf")).json()) as {
        token: string;
      }
    ).token;

  const login = await api.post("/admin/api/auth/login", {
    headers,
    data: { email, password: TEMPORARY_PASSWORD, csrfToken: await csrfToken() },
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

  // Dev auto-login issues a super-admin session to any visit WITHOUT a valid
  // one, so a sign-in that quietly failed would leave a context that can open
  // everything, and every refusal a test expects would simply not happen.
  // Asking who this is turns that into a failure here instead.
  const me = await api.get("/admin/api/me/permissions");
  expect(me.ok(), await me.text()).toBe(true);
  expect(((await me.json()) as { isSuperAdmin: boolean }).isSuperAdmin).toBe(
    false
  );

  return { context, email, userId, roleId };
}
