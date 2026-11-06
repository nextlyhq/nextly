/**
 * The API key form says what a key will do, and the list says whose each key
 * is, when it ends and when it was last used.
 *
 * The form's summary is only worth showing if it is the server's answer for
 * the chosen type and role, so each case reads that answer from the summary
 * endpoint and compares it with what the form draws. The dev user is a
 * super-admin, whose read-only key reads every collection: a summary built
 * from the viewer's own permissions in the browser would draw something else.
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.schema, LOCK.usersRoles] });

const API = "/admin/api";

interface Ability {
  slug: string;
  action: string;
  resource: string;
}

interface ListedKey {
  id: string;
  name: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  owner: { id: string; name: string | null; email: string } | null;
}

/** The server's answer for a type and role, grouped as the form groups it. */
async function serverSummary(
  page: Page,
  query: string
): Promise<Record<string, string[]>> {
  const res = await page.request.get(`${API}/api-keys/abilities?${query}`);
  expect(res.ok(), `asking for the summary: ${res.status()}`).toBe(true);
  const { items } = (await res.json()) as { items: Ability[] };
  const grouped: Record<string, string[]> = {};
  for (const { resource, action } of items) {
    (grouped[resource] ??= []).push(action);
  }
  for (const actions of Object.values(grouped)) actions.sort();
  return grouped;
}

/** What the form's summary draws, grouped by resource. */
async function drawnSummary(page: Page): Promise<Record<string, string[]>> {
  const summary = page.getByTestId("api-key-summary");
  await expect(summary).toBeVisible();
  return summary.locator("li[data-resource]").evaluateAll(rows => {
    const grouped: Record<string, string[]> = {};
    for (const row of rows) {
      const resource = row.getAttribute("data-resource") ?? "";
      grouped[resource] = Array.from(row.querySelectorAll("[data-action]"))
        .map(chip => chip.getAttribute("data-action") ?? "")
        .sort();
    }
    return grouped;
  });
}

async function chooseTokenType(page: Page, label: string): Promise<void> {
  await page.getByRole("combobox", { name: "Token Type" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test.describe("what the key form says a key will do", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdmin(page, "/settings/api-keys/create");
  });

  test("a read-only key: the server's answer, every collection a super-admin can read", async ({
    page,
  }) => {
    const expected = await serverSummary(page, "tokenType=read-only");
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    for (const actions of Object.values(expected)) {
      expect(actions).toEqual(["read"]);
    }
    await expect(page.getByText(/It follows your permissions/)).toBeVisible();

    expect(await drawnSummary(page)).toEqual(expected);
  });

  test("a full-access key: the server's answer", async ({ page }) => {
    await chooseTokenType(page, "Full access");
    const expected = await serverSummary(page, "tokenType=full-access");
    await expect(
      page.getByText(/when they change, this key's change with them/)
    ).toBeVisible();

    await expect
      .poll(async () => drawnSummary(page), { timeout: 10_000 })
      .toEqual(expected);
  });

  test("a role-based key: the chosen role's answer, and a prompt until one is chosen", async ({
    page,
  }) => {
    const roles = await page.request.get(`${API}/roles?limit=100`);
    expect(roles.ok(), `listing roles: ${roles.status()}`).toBe(true);
    const { items } = (await roles.json()) as {
      items: { id: string; slug: string; name: string }[];
    };
    // A role a key may take: not super-admin, and not the built-in Public
    // role, which the server gives to no person and no key.
    const role = items.find(
      candidate => !["super-admin", "public"].includes(candidate.slug)
    );
    expect(role, "a role other than super-admin and Public").toBeDefined();

    await chooseTokenType(page, "Role-based");
    await expect(
      page.getByText("Choose a role to see what this key will be able to do.")
    ).toBeVisible();

    await page.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: role!.name, exact: true }).click();
    const expected = await serverSummary(
      page,
      `tokenType=role-based&roleId=${role!.id}`
    );

    await expect
      .poll(async () => drawnSummary(page), { timeout: 10_000 })
      .toEqual(expected);
  });
});

test("the key list shows each key's owner, expiry and last use", async ({
  page,
  baseURL,
}) => {
  const stamp = Date.now();
  const create = async (name: string) => {
    const res = await page.request.post(`${API}/api-keys`, {
      data: { name, tokenType: "read-only", expiresIn: "30d" },
    });
    expect(res.status(), `creating ${name}`).toBe(201);
    return (await res.json()) as {
      item: { doc: { id: string }; key: string };
    };
  };
  const used = await create(`Key in use ${stamp}`);
  const unused = await create(`Key left idle ${stamp}`);

  // A request made with the key alone: Node's own fetch, which carries no
  // cookie, so nothing but the key can answer for it.
  if (!baseURL) throw new Error("The suite configures no baseURL.");
  const withKey = (key: string) =>
    fetch(new URL(`${API}/api-keys`, baseURL), {
      headers: { authorization: `Bearer ${key}` },
    });
  // The control: a key that does not exist is refused, so the request below
  // is answered as its key and not as anyone signed in.
  expect((await withKey("nx_live_not-a-key-of-this-install")).status).toBe(401);
  const call = await withKey(used.item.key);
  expect(call.ok, `a request with the key: ${call.status}`).toBe(true);

  // The server's own list, once the use is recorded.
  let listed: ListedKey[] = [];
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${API}/api-keys`);
        listed = ((await res.json()) as { items: ListedKey[] }).items;
        return listed.find(key => key.id === used.item.doc.id)?.lastUsedAt;
      },
      { timeout: 10_000 }
    )
    .not.toBeNull();
  const usedRow = listed.find(key => key.id === used.item.doc.id)!;
  const unusedRow = listed.find(key => key.id === unused.item.doc.id)!;
  expect(unusedRow.lastUsedAt).toBeNull();
  expect(usedRow.owner).not.toBeNull();
  expect(usedRow.expiresAt).not.toBeNull();

  await gotoAdmin(page, "/settings/api-keys");
  // A body row is announced as a button, since the whole row opens the key,
  // so rows are found by structure rather than by the row role.
  const table = page.getByRole("table", { name: "API keys table" });
  const row = (name: string) =>
    table.locator("tbody tr").filter({ hasText: name });

  const owner = usedRow.owner!.name ?? usedRow.owner!.email;
  await expect(row(`Key in use ${stamp}`)).toContainText(owner);
  await expect(row(`Key left idle ${stamp}`)).toContainText(owner);
  // Last use: a relative time for the used key, "Never" for the other.
  const usedCells = row(`Key in use ${stamp}`).getByRole("cell");
  const unusedCells = row(`Key left idle ${stamp}`).getByRole("cell");
  const header = page.getByRole("columnheader");
  const lastUsedIndex = await header.evaluateAll(cells =>
    cells.findIndex(cell => cell.textContent?.trim() === "Last Used")
  );
  const expiresIndex = await header.evaluateAll(cells =>
    cells.findIndex(cell => cell.textContent?.trim() === "Expires")
  );
  expect(lastUsedIndex).toBeGreaterThanOrEqual(0);
  expect(expiresIndex).toBeGreaterThanOrEqual(0);
  await expect(unusedCells.nth(lastUsedIndex)).toHaveText("Never");
  await expect(usedCells.nth(lastUsedIndex)).not.toHaveText("Never");
  await expect(usedCells.nth(expiresIndex)).not.toHaveText("Never");
});
