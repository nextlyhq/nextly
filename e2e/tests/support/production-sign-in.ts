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
  superAdminRoleId,
  uniqueTag,
  type StorageState,
} from "./accounts";
import {
  signIn as signInSeededUser,
  SESSION_MAX_AGE_MS,
  STORAGE_STATE,
} from "./session.mjs";
import { test } from "./visible";

/** The seeded user's session in this worker, by server, and when it was made. */
const seeded = new Map<
  string,
  { admin: Promise<APIRequestContext>; at: number }
>();

/** The seeded user's API, signed in once a worker and renewed before it expires. */
function seededAdmin(server: string): Promise<APIRequestContext> {
  const held = seeded.get(server);
  if (held !== undefined && Date.now() - held.at <= SESSION_MAX_AGE_MS) {
    return held.admin;
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
  seeded.set(server, { admin, at: Date.now() });
  // A failed sign-in is not kept, so the next file asks again.
  admin.catch(() => seeded.delete(server));
  return admin;
}

/** Each file's account in this worker, by file and retry. */
const fileAccounts = new Map<string, Promise<StorageState>>();

function accountOf(server: string, file: string, retry: number) {
  const key = `${file}#${retry}`;
  let made = fileAccounts.get(key);
  if (made === undefined) {
    made = (async () => {
      const admin = await seededAdmin(server);
      const { storageState } = await createSignedInUser(admin, server, {
        email: `production-spec-${uniqueTag()}@nextly.local`,
        name: "Spec Author",
        roleIds: [await superAdminRoleId(admin)],
      });
      return storageState;
    })();
    fileAccounts.set(key, made);
    // A failed sign-in is not kept, so the next test asks again.
    made.catch(() => fileAccounts.delete(key));
  }
  return made;
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
  const { cookies } = await accountOf(server, info.file, info.retry);
  await page.context().addCookies(cookies);
  await page.goto("/admin");
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  return page.request;
}
