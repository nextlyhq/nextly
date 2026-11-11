/**
 * What the admin keeps on the device between visits, read straight from the
 * browser's storage:
 *
 * - a second tab, with every admin request held, draws the real rail and
 *   Content panel from it before the server answers;
 * - after a session that opened an entry, the media library and a user, it
 *   holds only the metadata: none of their values, each planted with a marker
 *   the test looks for, so a store that kept any of them is caught by name;
 * - a change to a role's access discards what was kept under the old
 *   permission version on the next fresh tab, a schema the person may no
 *   longer read included, which nothing the server sends again replaces;
 * - signing out in one tab empties it, all but the site's public branding,
 *   and signs the other tab out;
 * - with remembering turned off for the site, what was kept is removed on the
 *   next visit and nothing is written after it;
 * - an edit page whose entry is held draws its outline and none of the
 *   entry's values, though the entry was opened before.
 *
 * The playground signs a visitor with no session in as its seeded user, so
 * after a sign-out the session requests are held: what is checked is the
 * signing out, not the signing in that would follow it.
 *
 * @module tests/device-memory.spec
 */
import {
  expect,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";

import { uniqueTag } from "./support/accounts";
import { ADMIN } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { uploadImage } from "./support/media-upload";
import { createEntry } from "./support/runtime-collection";
import { STORAGE_STATE } from "./support/session.mjs";
import { waitForShellAnswers } from "./support/shell-geometry";
import { test } from "./support/test";

const MEMORY = "nextly:admin:memory:";
const MENU_KEY = `${MEMORY}menu`;
const BRANDING_KEY = `${MEMORY}branding`;
const SIGNED_IN_HERE_KEY = "nextly:admin:signed-in-here";

/** Everything in this origin's storage, both kinds, by key. */
type Stored = Record<string, string>;

async function storedOn(page: Page): Promise<Stored> {
  return page.evaluate(() => {
    const all: Record<string, string> = {};
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (key !== null) all[key] = store.getItem(key) ?? "";
      }
    }
    return all;
  });
}

/** The remembered menu as stored, with its labels. */
interface StoredMenu {
  labels: { user?: string; permissionVersion?: string };
  data: {
    rail: { id: string; label: string }[];
    collections: { slug: string; label: string }[];
  };
}

function menuOf(stored: Stored): StoredMenu | undefined {
  const text = stored[MENU_KEY];
  return text === undefined ? undefined : (JSON.parse(text) as StoredMenu);
}

/** Until the device holds a remembered menu listing `slug`. */
async function menuRemembers(page: Page, slug: string): Promise<void> {
  await expect
    .poll(
      async () =>
        menuOf(await storedOn(page))?.data.collections.map(c => c.slug) ?? [],
      { timeout: 30_000 }
    )
    .toContain(slug);
}

/** The admin's API requests, save the development server's reload stream. */
const isAdminRequest = (url: URL): boolean =>
  url.pathname.startsWith("/admin/api/") &&
  url.pathname !== "/admin/api/dev-reload";

/** Holds every request `matches` until `release`; counts what it held. */
async function hold(page: Page, matches: (url: URL) => boolean) {
  let release = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let held = 0;
  await page.route(matches, async (route: Route) => {
    held += 1;
    try {
      await released;
      await route.continue();
    } catch {
      // The page went away while the request was held.
    }
  });
  return { release, held: () => held };
}

/** Opens an admin page and waits for every answer the rail draws from. */
async function openSettled(page: Page, path: string): Promise<void> {
  await page.goto(`${ADMIN}${path}`);
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  await waitForShellAnswers(page);
}

test.describe("the admin's memory on this device", () => {
  test("draws the real rail and Content panel in a second tab before the server answers", async ({
    page,
    context,
  }) => {
    await openSettled(page, "/collections/posts");
    await menuRemembers(page, "posts");

    const second = await context.newPage();
    const held = await hold(second, isAdminRequest);
    await second.goto(`${ADMIN}/collections/posts`, { waitUntil: "commit" });

    const rail = second.locator("aside[data-shell-answers]");
    // The real entries, by name, in place of the neutral shapes: a link, or
    // a button for an entry that only opens its panel.
    const entry = (name: string) =>
      rail
        .getByRole("link", { name, exact: true })
        .or(rail.getByRole("button", { name, exact: true }));
    for (const name of ["Dashboard", "Content", "Media Library"]) {
      await expect(entry(name)).toBeVisible();
    }
    await expect(second.getByTestId("rail-ghost-item")).toHaveCount(0);
    // The Content panel, with the collections the person sees.
    const panel = second.getByTestId("sub-sidebar");
    await expect(panel.getByTestId("remembered-content")).toBeVisible();
    await expect(
      panel.getByRole("link", { name: "Posts", exact: true })
    ).toBeVisible();
    // Drawn from memory: the requests really were held, and the server's own
    // answer has not replaced the rail.
    expect(held.held()).toBeGreaterThan(0);
    await expect(rail).toHaveAttribute("data-shell-answers", "pending");

    held.release();
    await waitForShellAnswers(second);
    await expect(panel.getByTestId("remembered-content")).toHaveCount(0);
    await second.close();
  });

  test("keeps only the metadata after a session that opened an entry, media and a user", async ({
    page,
  }) => {
    const tag = uniqueTag();
    const marker = {
      entry: `Remembered entry ${tag}`,
      media: `remembered-${tag}`,
      user: `Remembered person ${tag}`,
      email: `remembered-${tag}@nextly.local`,
    };
    const api = page.request;
    const postId = await createEntry(api, "posts", {
      title: marker.entry,
      slug: `remembered-${tag}`,
    });
    await uploadImage(api, marker.media);
    const user = await api.post("/admin/api/users", {
      data: {
        email: marker.email,
        name: marker.user,
        password: `Remembered-${tag}-Pass1!`,
        isActive: true,
      },
    });
    expect(user.status(), await user.text()).toBe(201);
    const userId = ((await user.json()) as { item: { id: string } }).item.id;

    await openSettled(page, `/collections/posts/${postId}`);
    await expect(
      page.locator("main").getByRole("textbox", { name: "Title", exact: true })
    ).toHaveValue(marker.entry);
    await openSettled(page, "/media");
    await expect(page.locator("main")).toContainText(marker.media);
    await openSettled(page, `/users/edit/${userId}`);
    await expect(page.locator("main")).toContainText(marker.email);
    await menuRemembers(page, "posts");

    const stored = await storedOn(page);
    // The positive control: the store did keep the metadata it may.
    expect(stored[MENU_KEY]).toBeDefined();
    expect(stored[SIGNED_IN_HERE_KEY]).toBe("1");

    // None of what the session opened, by any of its values, in any key.
    for (const [key, value] of Object.entries(stored)) {
      for (const planted of Object.values(marker)) {
        expect(value, `${key} holds "${planted}"`).not.toContain(planted);
      }
      expect(value, `${key} holds the entry's id`).not.toContain(postId);
      expect(value, `${key} holds the user's id`).not.toContain(userId);
    }
    for (const [key, value] of Object.entries(stored)) {
      // Only the admin's metadata, interface preferences and the record.
      expect(key, `an unexpected key, ${key}`).toMatch(
        /^(nextly:admin:memory:(menu|branding|schema:\/(collections(\/schema)?|singles|field-groups)\/[^/]+(\/schema)?)|nextly:admin:signed-in-here|nextly:(admin|panel-open|sidebar|journal)[:\w-]*|nextly-[\w-]+|builder\.showSystemInternals)$/
      );
      expect(value.toLowerCase(), `${key} holds a token`).not.toMatch(
        /token|password|"permissions"|read-posts/
      );
    }
  });

  test.describe("for a person whose access changes", () => {
    let limited: LimitedUser;
    let admin: APIRequestContext;

    test.beforeAll(async ({ browser, playwright }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      if (baseURL === undefined) throw new Error("[e2e] No baseURL.");
      admin = await playwright.request.newContext({
        baseURL,
        storageState: STORAGE_STATE,
      });
      limited = await signInAsLimitedUser(browser, admin, baseURL, [
        "read-posts",
        "read-tags",
      ]);
    });

    test.afterAll(async () => {
      await limited?.context.close();
      await admin?.dispose();
    });

    test("discards the remembered menu on the next fresh tab once a role's access changes", async () => {
      const page = await limited.context.newPage();
      await openSettled(page, "/collections/tags");
      await menuRemembers(page, "tags");
      await expect
        .poll(async () => Object.keys(await storedOn(page)))
        .toContain(`${MEMORY}schema:/collections/tags`);
      const before = menuOf(await storedOn(page));
      expect(before?.labels.user).toBe(limited.userId);
      await page.close();

      // Tags is taken away from the role.
      const list = await admin.get("/admin/api/permissions?page=1&limit=1000");
      const { items } = (await list.json()) as {
        items: { id: string; slug: string }[];
      };
      const readPosts = items.find(item => item.slug === "read-posts");
      expect(readPosts).toBeDefined();
      const updated = await admin.patch(`/admin/api/roles/${limited.roleId}`, {
        data: { permissionIds: [readPosts?.id] },
      });
      expect(updated.ok(), await updated.text()).toBe(true);

      const fresh = await limited.context.newPage();
      await openSettled(fresh, "/");
      await expect
        .poll(
          async () =>
            menuOf(await storedOn(fresh))?.labels.permissionVersion ??
            "missing",
          { timeout: 30_000 }
        )
        .not.toBe(before?.labels.permissionVersion);
      const after = await storedOn(fresh);
      // Kept under the old permission version, and never sent again: only the
      // label's mismatch could have removed it.
      expect(Object.keys(after)).not.toContain(
        `${MEMORY}schema:/collections/tags`
      );
      expect(menuOf(after)?.data.collections.map(c => c.slug)).not.toContain(
        "tags"
      );
      await fresh.close();
    });

    test("signs out in every tab and keeps nothing but the public branding", async () => {
      const first = await limited.context.newPage();
      const second = await limited.context.newPage();
      await openSettled(first, "/collections/posts");
      await openSettled(second, "/collections/posts");
      await menuRemembers(first, "posts");
      expect(Object.keys(await storedOn(first))).toContain(SIGNED_IN_HERE_KEY);

      // From here a session check would sign the playground's seeded user in.
      const sessionCheck = (url: URL) =>
        url.pathname === "/admin/api/auth/session" ||
        url.pathname === "/admin/api/startup";
      await hold(first, sessionCheck);
      // The other tab hears nothing from the server: it can learn of the
      // sign-out only from the tab that signed out.
      await hold(second, isAdminRequest);

      await first
        .getByTestId("rail-account")
        .getByRole("button", { name: "User profile menu" })
        .click();
      await first.getByRole("menuitem", { name: "Sign out" }).click();

      await expect(first).toHaveURL(/\/admin\/login/, { timeout: 30_000 });
      // The other tab, told by the first, leaves the signed-in screens too.
      await expect(second).toHaveURL(/\/admin\/login/, { timeout: 30_000 });

      for (const tab of [first, second]) {
        const keys = Object.keys(await storedOn(tab));
        expect(
          keys.filter(key => key !== BRANDING_KEY),
          "kept after signing out"
        ).toEqual([]);
      }
      await first.close();
      await second.close();
    });
  });

  test("removes what it kept and writes nothing once the site turns remembering off", async ({
    page,
  }) => {
    await openSettled(page, "/collections/posts");
    await menuRemembers(page, "posts");
    // The positive control: there was something to remove.
    expect(Object.keys(await storedOn(page)).length).toBeGreaterThan(0);

    // The server says remembering is off, as a site that set it does.
    await page.route(
      url => url.pathname === "/admin/api/startup",
      async route => {
        try {
          const response = await route.fetch();
          await route.fulfill({
            response,
            headers: {
              ...response.headers(),
              "x-nextly-device-memory": "off",
            },
          });
        } catch {
          // The page went away while the answer was on its way.
        }
      }
    );
    await openSettled(page, "/collections/posts");
    await expect.poll(async () => storedOn(page)).toEqual({});

    // Browsing on writes nothing: a list, an entry's form, the dashboard.
    await openSettled(page, "/");
    await openSettled(page, "/collections/posts/create");
    await openSettled(page, "/collections/posts");
    await page.waitForTimeout(1_000);
    expect(await storedOn(page)).toEqual({});
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("never fills an edit form from what it remembered", async ({
    page,
    context,
  }) => {
    const title = `Held entry ${uniqueTag()}`;
    const postId = await createEntry(page.request, "posts", {
      title,
      slug: `held-${uniqueTag()}`,
    });
    // Opened once, so a store that kept entries would hold this one.
    await openSettled(page, `/collections/posts/${postId}`);
    const titleBox = (tab: Page) =>
      tab.locator("main").getByRole("textbox", { name: "Title", exact: true });
    await expect(titleBox(page)).toHaveValue(title);

    const fresh = await context.newPage();
    const entryPath = `/admin/api/collections/posts/entries/${postId}`;
    const held = await hold(fresh, url => url.pathname === entryPath);
    await fresh.goto(`${ADMIN}/collections/posts/${postId}`);
    // The page's outline while its entry is held, and none of its values.
    await expect(
      fresh.locator('[data-testid="screen-outline"]').first()
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => held.held()).toBeGreaterThan(0);
    await expect(fresh.locator("main")).not.toContainText(title);
    const values = await fresh
      .locator("main input, main textarea")
      .evaluateAll(fields =>
        fields.map(field => (field as HTMLInputElement).value)
      );
    expect(values).not.toContain(title);

    // The positive control: released, the entry's own request fills it.
    held.release();
    await expect(titleBox(fresh)).toHaveValue(title, { timeout: 30_000 });
    await fresh.close();
  });
});
