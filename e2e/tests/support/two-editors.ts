/**
 * Two people on one document, for the lock specs: a second editor in a browser
 * context of their own, and the claim the lock route reports.
 *
 * The lock is held per user, so one user in two tabs is one holder and proves
 * nothing. The second editor is a second super-admin, signed in in a context
 * of its own (see `./accounts`).
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { createSignedInUser, superAdminRoleId, uniqueTag } from "./accounts";

/** A document an editor claims, as the document-lock route names it. */
export interface LockedDocument {
  scopeKind: "collection" | "single";
  slug: string;
  entryId: string;
}

/** The holder the lock route reports, in the fields these specs read. */
interface LockHolder {
  ownerLabel: string | null;
}

/** The second editor's display name. */
export const SECOND_EDITOR = "Second Editor";

/**
 * A second super-admin, signed in in a context of its own, so its page and
 * `first` are two lock holders.
 */
export async function secondEditor(
  browser: Browser,
  first: Page,
  baseURL: string | undefined
): Promise<{ context: BrowserContext; page: Page }> {
  if (!baseURL) throw new Error("The suite configures no baseURL.");
  const { storageState } = await createSignedInUser(first.request, baseURL, {
    email: `second-editor-${uniqueTag()}@nextly.local`,
    name: SECOND_EDITOR,
    roleIds: [await superAdminRoleId(first.request)],
  });
  // A context from `browser` inherits none of the test's options, so it is
  // given the address and the second editor's session.
  const context = await browser.newContext({ baseURL, storageState });
  return { context, page: await context.newPage() };
}

/**
 * Waits until the lock route reports a holder of `document`, and returns the
 * label it names them by.
 *
 * An editor's form claims the document as it opens, a round trip after the
 * page draws. A second editor arriving before that claim lands would find the
 * document free and claim it themself, and the spec would be testing who got
 * there first. Asked of the route rather than read off the page, since the
 * holder's own page shows nothing while it holds.
 */
export async function claimedBy(
  api: APIRequestContext,
  document: LockedDocument
): Promise<string> {
  let label: string | null = null;
  await expect
    .poll(
      async () => {
        const holder = await holderOf(api, document);
        label = holder?.ownerLabel ?? null;
        return holder !== null;
      },
      { message: "the editor's form claims the document", timeout: 30_000 }
    )
    .toBe(true);
  // Named, as the banners below quote it: a holder with no label would make
  // their sentences read "null is editing this document".
  expect(label, "the holder's label").toBeTruthy();
  return String(label);
}

/**
 * Waits until the lock route names `label` as the holder of `document`.
 *
 * What a screen shows after a takeover is the client's account of it; this is
 * the database's. A takeover the page drew but the server never recorded
 * passes every check made of the page and fails this one.
 */
export async function expectHeldBy(
  api: APIRequestContext,
  document: LockedDocument,
  label: string
): Promise<void> {
  await expect
    .poll(async () => (await holderOf(api, document))?.ownerLabel ?? null, {
      message: `the lock route names ${label} as the holder`,
      timeout: 30_000,
    })
    .toBe(label);
}

/** The holder the lock route reports for `document`, or null when it is free. */
async function holderOf(
  api: APIRequestContext,
  document: LockedDocument
): Promise<LockHolder | null> {
  const read = await api.get(
    `/admin/api/document-lock?${new URLSearchParams({ ...document })}`
  );
  expect(read.ok(), await read.text()).toBe(true);
  return ((await read.json()) as { holder: LockHolder | null }).holder;
}
