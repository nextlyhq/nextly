/**
 * Role inheritance must resolve in one direction.
 *
 * A role collects the permissions of the roles it inherits from. Those are
 * stored as its `childRoleId`s: creating a role with base role B writes
 * `role_inherits(parentRoleId = theNewRole, childRoleId = B)`, and the new
 * role then collects B's permissions. Inheritance therefore flows from child
 * to parent, and only that way.
 *
 * Walking the other way as well makes the edge symmetric, which turns the
 * hierarchy into an undirected graph: a user's effective roles become every
 * role reachable from theirs, so the base role silently gains everything its
 * dependants hold. These tests pin the direction against that.
 *
 * Real in-memory SQLite via the boot harness rather than mocks: the defect is
 * in which rows the traversal selects, and a mock would answer whatever the
 * traversal asked for.
 */
import { createTestNextly, type TestNextly } from "nextly/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";

import { listEffectivePermissions } from "./permissions";

let harness: TestNextly | undefined;

/** Ids of the fixture below, resolved in beforeEach. */
let viewerRoleId: string;
let editorRoleId: string;

/**
 * Inserts a user and grants it a role, returning the user id.
 *
 * Written against drizzle rather than the adapter's `insert` because the two
 * disagree on column naming (`insert` takes snake_case, `where` takes the JS
 * property names), and the tables object is the unambiguous form.
 */
async function createUserWithRole(
  email: string,
  roleId: string
): Promise<string> {
  const db = harness!.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  };
  const tables = getDialectTables();
  const userId = `user-${email}`;

  await db.insert(tables.users).values({
    id: userId,
    email,
    name: email,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(tables.userRoles).values({
    id: `user-role-${email}`,
    userId,
    roleId,
    createdAt: new Date(),
  });

  return userId;
}

beforeEach(async () => {
  harness = await createTestNextly();

  const readPosts = await harness.nextly.permissions.create({
    data: {
      action: "read",
      resource: "posts",
      name: "Read posts",
      slug: "read-posts",
    },
  });
  const deletePosts = await harness.nextly.permissions.create({
    data: {
      action: "delete",
      resource: "posts",
      name: "Delete posts",
      slug: "delete-posts",
    },
  });

  // Viewer holds read. Editor inherits Viewer and adds delete: Editor is the
  // parent, Viewer the child, so Editor collects read + delete and Viewer
  // must keep only read.
  const viewer = await harness.nextly.roles.create({
    data: {
      name: "Viewer",
      slug: "viewer",
      permissionIds: [readPosts.item.id],
    },
  });
  viewerRoleId = viewer.item.id;

  const editor = await harness.nextly.roles.create({
    data: {
      name: "Editor",
      slug: "editor",
      permissionIds: [deletePosts.item.id],
      childRoleIds: [viewerRoleId],
    },
  });
  editorRoleId = editor.item.id;
});

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

describe("role inheritance direction", () => {
  it("gives an inheriting role its own permissions and its base's", async () => {
    const userId = await createUserWithRole("editor@test", editorRoleId);

    const effective = await listEffectivePermissions(userId);

    expect(effective).toEqual(["posts:delete", "posts:read"]);
  });

  // The escalation. Viewer is Editor's base; nothing about that should hand
  // Viewer anything Editor holds. Traversing parents as well as children
  // makes the edge bidirectional and grants `posts:delete` to every Viewer.
  it("does not leak a dependant's permissions back to the base role", async () => {
    const userId = await createUserWithRole("viewer@test", viewerRoleId);

    const effective = await listEffectivePermissions(userId);

    expect(effective).toEqual(["posts:read"]);
    expect(effective).not.toContain("posts:delete");
  });

  it("resolves a user holding only the base role to the base role alone", async () => {
    const userId = await createUserWithRole("base-only@test", viewerRoleId);

    const effective = await listEffectivePermissions(userId);

    expect(effective).toHaveLength(1);
  });
});
