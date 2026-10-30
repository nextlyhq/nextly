/**
 * A role that may read and publish Posts, but not change them, opens a post
 * read-only and publishes it: a draft with Publish, and an editor's finished
 * draft of a published post with Publish changes. Each publish names only the
 * status, which the publish permission judges, so it goes through where a
 * save would be refused.
 *
 * `entry-opens-read-only.spec.ts` is the control: a role that may only read
 * Posts is led by nothing, so the Publish here is the publish permission.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { createEntry, expectOk } from "./support/runtime-collection";

// One signed-in user for the whole file: signing in spends the auth budget.
test.describe.configure({ mode: "serial" });

// Unique to this attempt: a retry runs `beforeAll` again.
const RUN = Date.now().toString(36);

let admin: APIRequestContext;
let publisher: LimitedUser;
let page: Page;
let draftId: string;
let publishedId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  draftId = await createEntry(admin, "posts", {
    title: `A draft to publish ${RUN}`,
    slug: `publish-only-draft-${RUN}`,
  });
  publishedId = await createEntry(admin, "posts", {
    title: `A live post ${RUN}`,
    slug: `publish-only-live-${RUN}`,
    excerpt: "Live excerpt.",
    status: "published",
  });
  // An editor's change to the live post, held as its draft.
  await expectOk(
    await admin.patch(`/admin/api/collections/posts/entries/${publishedId}`, {
      data: { excerpt: "The editor's finished excerpt." },
    }),
    "holding a draft of the live post"
  );
  publisher = await signInAsLimitedUser(browser, admin, baseURL, [
    "read-posts",
    "publish-posts",
  ]);
  page = await publisher.context.newPage();
});

test.afterAll(async () => {
  await publisher?.context.close();
  await admin?.dispose();
});

type Doc = Record<string, unknown>;

/** The post as stored: its live row, or with `all`, its latest. */
async function stored(id: string, all = false): Promise<Doc> {
  const response = await admin.get(
    `/admin/api/collections/posts/entries/${id}?depth=0${all ? "&status=all" : ""}`
  );
  await expectOk(response, `reading post ${id}`);
  const body = (await response.json()) as Doc & { item?: Doc };
  return body.item ?? body;
}

const READER_NOTICE =
  "Your access lets you view this, but not change it. If you need to change it, ask an admin.";

const leading = () => page.locator('[data-primary="true"]');

test("publishes a draft it may only read", async () => {
  await gotoAdmin(page, `/collections/posts/${draftId}`);
  await expect(page.getByTestId("document-lock-banner")).toHaveText(
    READER_NOTICE
  );
  // Nothing that saves is offered; Publish leads.
  await expect(page.locator('[data-action="save"]')).toHaveCount(0);
  await expect(leading()).toHaveText("Publish");

  await leading().click();
  await expect
    .poll(async () => (await stored(draftId, true)).status)
    .toBe("published");
});

test("publishes an editor's finished draft of a live post", async () => {
  await gotoAdmin(page, `/collections/posts/${publishedId}`);
  await expect(page.getByTestId("document-lock-banner")).toHaveText(
    READER_NOTICE
  );
  // POPULATION CONTROL: the editor's change is held, not live.
  expect((await stored(publishedId)).excerpt).toBe("Live excerpt.");
  await expect(leading()).toHaveText("Publish changes");

  await leading().click();
  await expect
    .poll(async () => (await stored(publishedId)).excerpt)
    .toBe("The editor's finished excerpt.");
});
