/**
 * Signing in on the production suite: one session per spec file, on the file's
 * own account, with the production server's real limits left in force.
 *
 * Dev auto-login is blocked on a production build, and the server holds each
 * account to its real auth limit (30 sign-ins an hour) and its REST limit (500
 * reads and 150 writes a minute). Through one shared account, signing in per
 * test spends the first and a suite this size spends the second, and the 429
 * reads as a form that does nothing.
 *
 * So, as the main suite does (`./test`), each file gets a super-admin of its
 * own, made through the seeded user's session. The seeded user signs in through
 * the real form, once per worker (`signIn` in `./session`); a worker restarted
 * by a failure signs in once more. A spec keeps the real form where the form is
 * its subject (`exit-demo`), or where its server is another one (`component-map`).
 *
 * A cached session goes stale during a long run: its access token ends, and
 * while a context that opened with it can refresh, the cookies of that refresh
 * never reach this cache, so the next context would open with an expired token
 * and a refresh token already spent. Each is therefore replaced before then
 * (`./session-lifetime`).
 *
 * @module tests/support/production-sign-in
 */
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  createSignedInUser,
  signInAgain,
  superAdminRoleId,
  uniqueTag,
  type SignedInUser,
  type StorageState,
} from "./accounts";
import { sessionNeedsRenewal } from "./session-lifetime";
import { signIn as signInSeededUser, STORAGE_STATE } from "./session.mjs";
import { test } from "./visible";

/** The seeded user's API in this worker, by server. */
const seeded = new Map<string, Promise<APIRequestContext>>();

/** The seeded user's API, signed in once a worker and renewed before it expires. */
async function seededAdmin(server: string): Promise<APIRequestContext> {
  const held = await seeded.get(server)?.catch(() => undefined);
  if (
    held !== undefined &&
    !sessionNeedsRenewal((await held.storageState()).cookies, Date.now())
  ) {
    return held;
  }
  const admin = (async () => {
    // A file of this worker's own: the stored file is the main suite's.
    const file = `${path.dirname(STORAGE_STATE)}/production-admin-${process.pid}.json`;
    await signInSeededUser(server, file);
    try {
      const storageState = JSON.parse(
        readFileSync(file, "utf8")
      ) as StorageState;
      return await request.newContext({ baseURL: server, storageState });
    } finally {
      rmSync(file, { force: true });
    }
  })();
  seeded.set(server, admin);
  // A failed sign-in is not kept, so the next file asks again.
  admin.catch(() => seeded.delete(server));
  return admin;
}

/** Each file's account in this worker, by file and retry. */
const fileAccounts = new Map<string, Promise<SignedInUser>>();

/** The file's account, made the first time its file asks. */
function accountOf(server: string, key: string): Promise<SignedInUser> {
  let made = fileAccounts.get(key);
  if (made === undefined) {
    made = (async () => {
      const admin = await seededAdmin(server);
      return createSignedInUser(admin, server, {
        email: `production-spec-${uniqueTag()}@nextly.local`,
        name: "Spec Author",
        roleIds: [await superAdminRoleId(admin)],
      });
    })();
    fileAccounts.set(key, made);
    // A failed sign-in is not kept, so the next test asks again.
    made.catch(() => fileAccounts.delete(key));
  }
  return made;
}

/** The file's session, signed in again before its access token runs out. */
async function sessionOf(
  server: string,
  file: string,
  retry: number
): Promise<StorageState> {
  const key = `${file}#${retry}`;
  const account = await accountOf(server, key);
  if (!sessionNeedsRenewal(account.storageState.cookies, Date.now())) {
    return account.storageState;
  }
  const storageState = await signInAgain(server, account.email);
  fileAccounts.set(key, Promise.resolve({ ...account, storageState }));
  return storageState;
}

/**
 * Leaves `page` signed in on the admin as its file's account and answers the
 * page's request context, which carries that session.
 *
 * @param page - The page to sign in, in the test's context or one of its own.
 */
export async function signIn(page: Page): Promise<APIRequestContext> {
  const info = test.info();
  const server = info.project.use.baseURL;
  if (server === undefined) {
    throw new Error("The production suite configures no baseURL.");
  }
  const { cookies } = await sessionOf(server, info.file, info.retry);
  await page.context().addCookies(cookies);
  await page.goto("/admin");
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  return page.request;
}
