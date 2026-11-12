/**
 * A custom user field's name is a database column and a key on the user object,
 * where it is assigned over the built-ins — so one named `email` displaces the
 * real address, and one named `id` displaces the identity that session creation
 * is handed. Both the form and the server refuse this; this checks the two agree
 * when a real request crosses between them.
 *
 * Safe to write against because the suite owns its database and empties it
 * before every run. Nothing here belongs to anyone.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

const FIELD_LABEL = "Job Title";
const FIELD_NAME = "job_title";

/** The shape the dispatcher actually answers with: everything under `error`. */
interface ApiError {
  error?: {
    code?: string;
    data?: { errors?: Array<{ path: string; code: string; message: string }> };
  };
}

/** Chooses a new field's type in the picker by search, with a label. */
async function chooseType(page: Page, search: string, label: string) {
  await page.getByRole("button", { name: "Choose a field type" }).click();
  const picker = page.getByRole("dialog");
  const box = picker.getByRole("combobox", { name: "Search field types" });
  await box.fill(search);
  await box.press("Enter");
  await picker.getByRole("textbox", { name: "Label" }).fill(label);
  await picker.getByRole("button", { name: "Add field" }).click();
  await expect(picker).toHaveCount(0);
}

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ mode: "serial", lock: [LOCK.usersRoles] });

test("a custom field can be created", async ({ page }) => {
  await gotoAdmin(page, "/users/fields/create");

  // The type and label are chosen in the field picker.
  await chooseType(page, "text", FIELD_LABEL);

  // The name is derived from the label, and that derivation is the only reason
  // a person never types a column identifier by hand.
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true })
  ).toHaveValue(FIELD_NAME);

  await page.getByRole("button", { name: "Create Field" }).click();

  // Generous timeout: dev mode compiles the list route on first navigation,
  // and a timeout here strands the created row for the retry to collide with.
  await expect(page).toHaveURL(/\/admin\/users\/fields$/, { timeout: 15_000 });
  await expect(page.getByText(FIELD_NAME).first()).toBeVisible();
});

test("name and type are fixed once the field exists", async ({ page }) => {
  await gotoAdmin(page, "/users/fields");
  await page.getByRole("button", { name: FIELD_NAME }).click();
  await expect(page).toHaveURL(/\/admin\/users\/fields\/edit\//);

  // Both identify the backing column, and the reconciler only ever adds
  // columns: renaming would stand the old one up alongside its stranded data.
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true })
  ).toBeDisabled();
  // The settings panel names the type and offers no way to choose another.
  await expect(page.getByText("Type: Text")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change type…" })).toHaveCount(
    0
  );

  // The label is the part that is safe to change, so it must stay editable —
  // a lock that took the whole form with it would be its own bug.
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true })
  ).toBeEnabled();

  // And the form says why, rather than going quietly grey.
  await expect(
    page.getByText(/cannot change once the field exists/i).first()
  ).toBeVisible();
});

test("the server refuses a name that would displace a built-in", async ({
  page,
  request,
}) => {
  await gotoAdmin(page, "/users/fields");

  // Through the API the admin itself uses, carrying the session the browser
  // holds: the form disables these inputs, so the server guard is the one that
  // has to hold, and it is the only one a script would ever meet.
  for (const name of ["email", "id", "passwordHash"]) {
    const response = await request.post("/admin/api/user-fields", {
      data: {
        name,
        label: "Displacing",
        type: "text",
        required: false,
        isActive: true,
      },
    });

    expect(response.status(), `creating a field named ${name}`).toBe(400);

    // The reason has to survive the trip, not just the refusal: a rejection
    // that reaches the admin as "an unexpected error occurred" is a bug of its
    // own, and this API has had exactly that one.
    const body = (await response.json()) as ApiError;
    const first = body.error?.data?.errors?.[0];
    expect(first?.path).toBe("name");
    expect(first?.code).toBe("USER_FIELD_NAME_RESERVED");
    expect(first?.message).toContain(name);
  }
});

test("a field the server accepts can be edited in the form", async ({
  page,
  request,
}) => {
  // camelCase is valid to the server (`/^[a-zA-Z][a-zA-Z0-9_]*$/`) and is what
  // `defineConfig()` fields normally look like. The form's own rule is
  // lowercase-only, and it validates the name even in edit mode — where the
  // input is disabled and the stored value is submitted back untouched. So a
  // field the server made is one the form refuses to save.
  const created = await request.post("/admin/api/user-fields", {
    data: {
      name: "phoneNumber",
      label: "Phone Number",
      type: "text",
      required: false,
      isActive: true,
    },
  });
  expect(created.status(), "the server accepts camelCase").toBe(201);

  await gotoAdmin(page, "/users/fields");
  await page.getByRole("button", { name: "phoneNumber" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/fields\/edit\//);

  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Mobile Number");
  await page.getByRole("button", { name: /Update Field/i }).click();

  // The redirect proves the submit was not blocked, which is what the original
  // bug did — it never left the edit page. Reading the field back proves the
  // stronger thing the redirect only implies: that the PATCH saved the label,
  // rather than redirecting on a write that changed nothing.
  await expect(page).toHaveURL(/\/admin\/users\/fields$/, { timeout: 10_000 });

  const list = await request.get("/admin/api/user-fields");
  const payload = (await list.json()) as {
    fields?: Array<{ name: string; label: string }>;
  };
  const saved = payload.fields?.find(f => f.name === "phoneNumber");
  expect(saved?.label).toBe("Mobile Number");
});

test("the server refuses a rename, and says why", async ({ page, request }) => {
  await gotoAdmin(page, "/users/fields");

  const list = await request.get("/admin/api/user-fields");
  // `fields`, not `items`: this endpoint answers with its own envelope, unlike
  // the entries list (`items`/`meta`) or a mutation (`message`/`item`).
  const payload = (await list.json()) as {
    fields?: Array<{ id: string; name: string }>;
  };
  const field = payload.fields?.find(f => f.name === FIELD_NAME);
  expect(
    field,
    `${FIELD_NAME} should exist from the earlier test`
  ).toBeTruthy();

  const renamed = await request.patch(`/admin/api/user-fields/${field!.id}`, {
    data: { name: "email" },
  });
  expect(renamed.status()).toBe(400);

  // The refusal alone is not the claim — "says why" is. Assert the reason
  // reaches the caller as a field error, the same shape a create rejection has.
  const renamedBody = (await renamed.json()) as ApiError;
  const renamedError = renamedBody.error?.data?.errors?.[0];
  expect(renamedError?.path).toBe("name");
  expect(renamedError?.code).toBe("USER_FIELD_NAME_IMMUTABLE");

  // A label-only edit must still go through: the guard rejects a change to the
  // field's identity, not every write.
  const relabelled = await request.patch(
    `/admin/api/user-fields/${field!.id}`,
    {
      data: { label: "Role Title" },
    }
  );
  expect(relabelled.status()).toBe(200);
});

test("adds, edits and reorders a field", async ({ page, request }) => {
  // Its own field to move past, so this does not lean on the tests above.
  await gotoAdmin(page, "/users/fields/create");
  await chooseType(page, "text", "Office");
  await page.getByRole("button", { name: "Create Field" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/fields$/, { timeout: 15_000 });

  await gotoAdmin(page, "/users/fields/create");
  await chooseType(page, "text", "Department");
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("Where they work");
  await page.getByRole("button", { name: "Create Field" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/fields$/, { timeout: 15_000 });

  // Lifted with the keyboard alone and moved above Office, just before it. The
  // pauses give dnd-kit a frame to process each keyboard event.
  const order = async () => {
    const list = await request.get("/admin/api/user-fields");
    const body = (await list.json()) as { fields?: Array<{ name: string }> };
    return (body.fields ?? []).map(field => field.name);
  };
  const before = await order();
  const at = before.indexOf("department");
  expect(before[at - 1], "Office is listed just before it").toBe("office");
  const handle = page.getByRole("button", {
    name: "Drag to reorder Department",
  });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect
    .poll(order, { timeout: 10_000 })
    .toEqual([
      ...before.slice(0, at - 1),
      "department",
      before[at - 1],
      ...before.slice(at + 1),
    ]);

  // Its description was saved with it.
  const list = await request.get("/admin/api/user-fields");
  const body = (await list.json()) as {
    fields?: Array<{ name: string; description: string | null }>;
  };
  expect(body.fields?.find(f => f.name === "department")?.description).toBe(
    "Where they work"
  );
});

test("saves and reloads, with no database review", async ({ page }) => {
  await gotoAdmin(page, "/users/fields");
  await page.getByRole("button", { name: "department", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users\/fields\/edit\//);

  // A user field's change is saved as it is: nothing asks about the database.
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("The team they belong to");
  await page.getByRole("button", { name: "Update Field" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/fields$/, { timeout: 15_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "department", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "The team they belong to"
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "The team they belong to",
    { timeout: 15_000 }
  );
});
