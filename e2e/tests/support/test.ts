/**
 * The `test` every spec in this suite is written with: Playwright's own, with
 * each spec file signed in as an account of its own.
 *
 * The REST limit gives each signed-in user a budget a minute (500 reads and
 * 150 writes by default). The whole suite through one session spends several
 * times that, and more as the server gets faster, but no single file comes
 * near it, so each file, and each retry of it, gets a super-admin of its own
 * and the default limits hold everywhere. A retry is a new account because it
 * spends its budget again. A file seeding more than its own budget allows
 * spreads the writes over further seats of its account (see `fileAccount`).
 *
 * The accounts are made through the seeded dev user's stored session, which
 * is renewed before each test (see `./session`) and does nothing else, so no
 * spec's writes can spend the budget the accounts are made with.
 * `storageState`, which the `context` and `page` a test is handed open with,
 * is the file's account. A spec that sets `storageState` itself with
 * `test.use` replaces it.
 *
 * The suite holds every spec to this `test` rather than Playwright's, which
 * would run without any of it (`session-stays-signed-in.spec.ts`).
 *
 * @module tests/support/test
 */
import { readFileSync } from "node:fs";

import {
  expect,
  request,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  createSignedInUser,
  superAdminRoleId,
  uniqueTag,
  type StorageState,
} from "./accounts";
import { configuredLocks } from "./configured-locks";
import { keepSessionFresh, STORAGE_STATE } from "./session";

/** A document an editor claims, as the document-lock route names it. */
interface DocumentRef {
  scopeKind: "collection" | "single";
  slug: string;
  entryId: string;
}

/**
 * A single's claim reference, from its id, or `null` when the single has no
 * document yet: nothing can claim a document that does not exist.
 */
function single(slug: string) {
  return async (api: APIRequestContext): Promise<DocumentRef | null> => {
    const read = await api.get(`/admin/api/singles/${slug}`);
    if (read.status() === 404) return null;
    expect(read.ok(), await read.text()).toBe(true);
    // A single's read is the bare document, not a mutation's `{ item }`.
    const { id } = (await read.json()) as { id: string };
    expect(id, `the ${slug} single's id`).toBeTruthy();
    return { scopeKind: "single", slug, entryId: id };
  };
}

/**
 * The locks whose state is a document an editor claims, and that document.
 *
 * Opening a shared single's form or builder claims the document for whoever
 * opened it, and the claim outlives the file that made it until its lease
 * runs out. The next file, or a retry, is signed in as someone else and would
 * find the document held and open it read-only. So each file holding one of
 * these locks frees its document before its first test, through the route the
 * builder's "Take over" uses. Done at the start rather than left to the file
 * before, so a file that crashed cannot leave the next one read-only, and only
 * under the lock, so it never takes a claim from a file still editing.
 */
const CLAIMED_DOCUMENTS: Readonly<
  Record<string, (api: APIRequestContext) => Promise<DocumentRef | null>>
> = {
  homepage: single("homepage"),
  siteSettings: single("site-settings"),
  landingPage: single("landing-page"),
};

/** The locks guarding a document its holders free, by `LOCK` name. */
export const CLAIMED_DOCUMENT_LOCKS = Object.keys(CLAIMED_DOCUMENTS);

/** The locks a spec file holds whose document it frees before it starts. */
export function documentsToFree(source: string, file: string): string[] {
  const held = configuredLocks(source, file);
  return Object.keys(CLAIMED_DOCUMENTS).filter(lock => held.has(lock));
}

/**
 * Takes the document over and gives it back, then checks nobody holds it.
 * Each step is asserted, so a changed lock route fails here rather than
 * leaving the next test to open the document read-only.
 */
async function freeDocument(api: APIRequestContext, lock: string) {
  const ref = await CLAIMED_DOCUMENTS[lock](api);
  if (ref === null) return;
  const claimed = await api.post("/admin/api/document-lock", {
    data: { ...ref, takeover: true },
  });
  expect(claimed.ok(), await claimed.text()).toBe(true);
  const { item } = (await claimed.json()) as {
    item: { status: string; claimToken?: string };
  };
  expect(item.status, `taking over the ${lock}`).toBe("acquired");

  const released = await api.delete("/admin/api/document-lock", {
    data: { ...ref, claimToken: item.claimToken },
  });
  expect(released.ok(), await released.text()).toBe(true);

  const read = await api.get(
    `/admin/api/document-lock?${new URLSearchParams({ ...ref })}`
  );
  expect(read.ok(), await read.text()).toBe(true);
  expect(
    ((await read.json()) as { holder: unknown }).holder,
    `the ${lock} is free`
  ).toBeNull();
}

/**
 * Each file's account, by file, retry attempt and seat. A worker is a
 * process of its own and runs a file's tests in order, so this module's map
 * is per worker and enough to hand every test in a file the same account.
 */
const fileAccounts = new Map<string, Promise<StorageState>>();

/**
 * The session of the file's account, for a `beforeAll` that cannot take the
 * test-scoped `storageState`. `seat` names a further account of the same
 * file, for seeding more than one account's write budget allows. The file's
 * own account (seat 0) frees the documents the file holds a lock on.
 */
export function fileAccount(
  baseURL: string,
  testInfo: Pick<TestInfo, "file" | "retry">,
  seat = 0
): Promise<StorageState> {
  const key = `${testInfo.file}#${testInfo.retry}#${seat}`;
  let made = fileAccounts.get(key);
  if (!made) {
    const documents =
      seat === 0
        ? documentsToFree(readFileSync(testInfo.file, "utf8"), testInfo.file)
        : [];
    made = signInNewAccount(baseURL, documents);
    fileAccounts.set(key, made);
    // A failed sign-in is not kept, so the next test asks again.
    made.catch(() => fileAccounts.delete(key));
  }
  return made;
}

async function signInNewAccount(
  baseURL: string,
  documents: readonly string[]
): Promise<StorageState> {
  await keepSessionFresh(baseURL);
  const admin = await request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  let storageState: StorageState;
  try {
    ({ storageState } = await createSignedInUser(admin, baseURL, {
      email: `spec-${uniqueTag()}@nextly.local`,
      name: "Spec Author",
      roleIds: [await superAdminRoleId(admin)],
    }));
  } finally {
    await admin.dispose();
  }
  if (documents.length > 0) {
    const api = await request.newContext({ baseURL, storageState });
    try {
      for (const lock of documents) await freeDocument(api, lock);
    } finally {
      await api.dispose();
    }
  }
  return storageState;
}

/**
 * The page's locators that, unlike a role locator, match hidden elements as
 * well as visible ones.
 */
const MATCHES_HIDDEN = [
  "getByText",
  "getByLabel",
  "getByTestId",
  "getByPlaceholder",
] as const;

/** Make one of `page`'s locators find visible elements only. */
function findVisibleOnly<M extends (typeof MATCHES_HIDDEN)[number]>(
  page: Page,
  method: M
): void {
  const find = page[method].bind(page) as (
    ...args: Parameters<Page[M]>
  ) => Locator;
  page[method] = ((...args: Parameters<Page[M]>) =>
    find(...args).filter({ visible: true })) as Page[M];
}

/**
 * The page's whole document, for a spec that means to find a hidden element:
 * locators chained from it are not held to visible elements, as the page's
 * own are. Named at each use, so a spec reaching a hidden element says so.
 */
export function includingHidden(page: Page): Locator {
  return page.locator(":root");
}

export const test = base.extend<{ freshSession: string }>({
  // Under Cache Components, Next.js keeps a visited page mounted but hidden,
  // so the document can hold a hidden copy of the page a spec is on. A role
  // locator leaves hidden elements out, but a text, label, test-id or
  // placeholder locator would match the hidden copy's as readily as the
  // visible one's, so on the page every spec is handed they find visible
  // elements only. A locator chained from one of them is held to it.
  page: async ({ page }, use) => {
    for (const method of MATCHES_HIDDEN) findVisibleOnly(page, method);
    await use(page);
  },
  freshSession: [
    async ({ baseURL }, use) => {
      if (baseURL) await keepSessionFresh(baseURL);
      await use(STORAGE_STATE);
    },
    { auto: true },
  ],
  storageState: async ({ baseURL }, use, testInfo) => {
    if (!baseURL) throw new Error("[e2e] No baseURL configured.");
    await use(await fileAccount(baseURL, testInfo));
  },
});
