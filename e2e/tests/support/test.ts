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
 * The locks whose state is a document an editor claims, and that document.
 *
 * Opening the homepage's form or builder claims the homepage for whoever
 * opened it, and the claim outlives the file that made it until its lease
 * runs out. The next file, signed in as someone else, would find the page
 * held and open it read-only. So each file holding the lock frees the
 * document before its first test, through the route the builder's "Take
 * over" uses. Done at the start rather than left to the file before, so a
 * file that crashed cannot leave the next one read-only.
 */
const CLAIMED_DOCUMENTS: Readonly<
  Record<string, (api: APIRequestContext) => Promise<DocumentRef>>
> = {
  homepage: async api => {
    const single = await api.get("/admin/api/singles/homepage");
    expect(single.ok(), await single.text()).toBe(true);
    // A single's read is the bare document, not a mutation's `{ item }`.
    const { id } = (await single.json()) as { id: string };
    expect(id, "the homepage's id").toBeTruthy();
    return { scopeKind: "single", slug: "homepage", entryId: id };
  },
};

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

export const test = base.extend<{ freshSession: string }>({
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
