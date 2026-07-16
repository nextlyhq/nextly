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
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const FIELD_LABEL = "Job Title";
const FIELD_NAME = "job_title";

/** The shape the dispatcher actually answers with: everything under `error`. */
interface ApiError {
  error?: {
    code?: string;
    data?: { errors?: Array<{ path: string; code: string; message: string }> };
  };
}

test.describe.configure({ mode: "serial" });

test("a custom field can be created", async ({ page }) => {
  await gotoAdmin(page, "/users/fields/create");

  await page.getByRole("textbox", { name: "Label" }).fill(FIELD_LABEL);

  // The name is derived from the label, and that derivation is the only reason
  // a person never types a column identifier by hand.
  await expect(page.getByRole("textbox", { name: "Field Name" })).toHaveValue(
    FIELD_NAME
  );

  await page.getByRole("button", { name: "Create Field" }).click();

  await expect(page).toHaveURL(/\/admin\/users\/fields$/);
  await expect(page.getByText(FIELD_NAME).first()).toBeVisible();
});

test("name and type are fixed once the field exists", async ({ page }) => {
  await gotoAdmin(page, "/users/fields");
  await page.getByRole("button", { name: FIELD_NAME }).click();
  await expect(page).toHaveURL(/\/admin\/users\/fields\/edit\//);

  // Both identify the backing column, and the reconciler only ever adds
  // columns: renaming would stand the old one up alongside its stranded data.
  await expect(
    page.getByRole("textbox", { name: "Field Name" })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /^Text/ }).first()
  ).toBeDisabled();

  // The label is the part that is safe to change, so it must stay editable —
  // a lock that took the whole form with it would be its own bug.
  await expect(page.getByRole("textbox", { name: "Label" })).toBeEnabled();

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

  await page.getByRole("textbox", { name: "Label" }).fill("Mobile Number");
  await page.getByRole("button", { name: /Update Field/i }).click();

  // Saved, rather than blocked by a complaint about a name nobody can change.
  await expect(page).toHaveURL(/\/admin\/users\/fields$/, { timeout: 10_000 });
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
