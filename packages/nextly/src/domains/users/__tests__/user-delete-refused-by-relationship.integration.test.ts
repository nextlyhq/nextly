/**
 * Deleting a user that a Schema Builder relationship to Users points at.
 *
 * A relationship to Users is keyed to the core `users` table. A required one refuses the account's
 * deletion before anything of the account is removed (its roles, its row), with a message naming
 * what still points at it; an optional one is emptied by the database and the deletion completes.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
}

describeEachDialect("deleting a user a relationship points at", dialect => {
  let current: TestNextly;
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  beforeEach(async () => {
    // The Builder applies a collection's creation in development.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
    // The first account made is the super-admin, which no test deletes.
    await current.nextly.users.create({
      email: "owner@refused.test",
      password: "Password123!",
      data: { name: "owner", isActive: true },
    });
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    const created = await handler.createCollection({
      name: "notes",
      label: "Note",
      fields: [
        { name: "title", type: "text" },
        {
          name: "author",
          label: "Author",
          type: "relationship",
          required: true,
          options: { target: "users", relationType: "manyToOne" },
        },
        {
          name: "editor",
          label: "Editor",
          type: "relationship",
          options: { target: "users", relationType: "manyToOne" },
        },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await current?.destroy();
  });

  async function user(name: string): Promise<string> {
    const made = await current.nextly.users.create({
      email: `${name}@refused.test`,
      password: "Password123!",
      data: { name, isActive: true },
    });
    return String((made.item as { id: string | number }).id);
  }

  const rows = (statement: string) =>
    current.adapter.executeQuery<Record<string, unknown>>(statement);

  const userIds = async () =>
    (await rows(`SELECT ${q("id")} FROM ${q("users")}`)).map(r => String(r.id));

  const roleRows = async (id: string) =>
    (
      await rows(
        `SELECT ${q("user_id")} FROM ${q("user_roles")} WHERE ${q("user_id")} = '${id}'`
      )
    ).length;

  it("keys a relationship to Users to the users table", async () => {
    const ada = await user("ada");
    // Enforced: a note naming an account that does not exist is refused.
    await expect(
      current.nextly.create({
        collection: "notes",
        data: { title: "x", author: "nobody-at-all" },
      })
    ).rejects.toThrow();
    await current.nextly.create({
      collection: "notes",
      data: { title: "One", author: ada },
    });
  });

  it("refuses deleting an account a required relationship points at, removing nothing of it", async () => {
    const ada = await user("ada");
    for (const title of ["One", "Two"]) {
      await current.nextly.create({
        collection: "notes",
        data: { title, author: ada },
      });
    }
    const rolesBefore = await roleRows(ada);

    const refusal = await current.nextly.users.delete({ id: ada }).then(
      () => null,
      (error: unknown) => error
    );

    expect(NextlyError.is(refusal)).toBe(true);
    expect((refusal as NextlyError).publicMessage).toBe(
      'This user is still used by 2 Notes in "Author". Change or delete those first.'
    );
    // Nothing of the account went: the row and its roles.
    expect(await userIds()).toContain(ada);
    expect(await roleRows(ada)).toBe(rolesBefore);
  });

  it("empties an optional relationship and deletes the account", async () => {
    const ada = await user("ada");
    const grace = await user("grace");
    await current.nextly.create({
      collection: "notes",
      data: { title: "One", author: ada, editor: grace },
    });

    await current.nextly.users.delete({ id: grace });

    expect(await userIds()).not.toContain(grace);
    const [row] = await rows(`SELECT ${q("editor")} FROM ${q("dc_notes")}`);
    expect(row?.editor ?? null).toBeNull();
  });
});
