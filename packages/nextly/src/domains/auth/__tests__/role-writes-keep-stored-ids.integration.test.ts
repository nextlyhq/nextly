/**
 * Role writes store each id as the row it names spells it.
 *
 * MySQL matches ids case-insensitively, so a request can name a user or a
 * role in another case and still reach the row. A write that stored the
 * request's spelling would leave an assignment or an inheritance row whose id
 * differs from its user's or role's own, and every reader comparing ids would
 * then have to know to match them as MySQL does. So each writer stores the
 * id it read back from the row. On PostgreSQL and SQLite ids match exactly,
 * so the id a request names is the row's own and is stored as given: the
 * control on every dialect holds that nothing there moves.
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const PASSWORD = "Str0ng-P@ssw0rd!";

interface RawDb {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  select: (fields: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Array<Record<string, unknown>>>;
    };
  };
}

function raw(): RawDb {
  return handle!.adapter.getDrizzle() as unknown as RawDb;
}

function services(): ServiceContainer {
  return new ServiceContainer(handle!.adapter);
}

async function boot(dialect: TestDialect): Promise<void> {
  handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
}

/** A role with no permissions or inheritance, its id a lower-case UUID. */
async function makeRole(slug: string): Promise<string> {
  const id = randomUUID();
  await raw().insert(getDialectTables().roles).values({
    id,
    name: slug,
    slug,
    level: 10,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function makeUser(email: string): Promise<string> {
  const created = await services().users.createLocalUser({
    email,
    name: email,
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

/** The ids of every assignment of `roleId` to `userId`, as stored. */
async function assignments(
  userId: string,
  roleId: string
): Promise<Array<{ userId: string; roleId: string }>> {
  const { userRoles } = getDialectTables();
  const rows = await raw()
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  return rows.map(row => ({
    userId: String(row.userId),
    roleId: String(row.roleId),
  }));
}

/** The inheritance rows `parent` → `child`, as stored. */
async function edges(
  parent: string,
  child: string
): Promise<Array<{ id: string; parentRoleId: string; childRoleId: string }>> {
  const { roleInherits } = getDialectTables();
  const rows = await raw()
    .select({
      id: roleInherits.id,
      parentRoleId: roleInherits.parentRoleId,
      childRoleId: roleInherits.childRoleId,
    })
    .from(roleInherits)
    .where(
      and(
        eq(roleInherits.parentRoleId, parent),
        eq(roleInherits.childRoleId, child)
      )
    );
  return rows.map(row => ({
    id: String(row.id),
    parentRoleId: String(row.parentRoleId),
    childRoleId: String(row.childRoleId),
  }));
}

describe.each(getConfiguredTestDialects())(
  "role writes keep ids as stored (%s)",
  dialect => {
    it("stores an assignment and an inheritance named by their exact ids as given", async () => {
      await boot(dialect);
      const user = await makeUser("exact@example.com");
      const role = await makeRole("exact");
      const child = await makeRole("exact-child");

      await services().userRoles.assignRoleToUser(user, role);
      await services().roleInheritance.addRoleInheritance(child, role);

      expect(await assignments(user, role)).toEqual([
        { userId: user, roleId: role },
      ]);
      expect(await edges(role, child)).toEqual([
        { id: `${role}::${child}`, parentRoleId: role, childRoleId: child },
      ]);
    });

    // MySQL matches ids case-insensitively, so a request naming them in
    // upper case still reaches these rows there.
    describe.runIf(dialect === "mysql")("ids named in another case", () => {
      it("stores a role assigned to a user as their rows spell them", async () => {
        await boot(dialect);
        const user = await makeUser("assigned@example.com");
        const role = await makeRole("assigned");

        const result = await services().userRoles.assignRoleToUser(
          user.toUpperCase(),
          role.toUpperCase()
        );

        expect(result.success).toBe(true);
        expect(await assignments(user, role)).toEqual([
          { userId: user, roleId: role },
        ]);
      });

      it("stores an account's requested role as the role's row spells it", async () => {
        await boot(dialect);
        await makeUser("first@example.com");
        const role = await makeRole("requested");

        const created = await services().users.createLocalUser({
          email: "requested@example.com",
          name: "Requested",
          password: PASSWORD,
          isActive: true,
          emailVerification: "admin-vouched",
          roles: [role.toUpperCase()],
        });

        expect(await assignments(String(created.id), role)).toEqual([
          { userId: String(created.id), roleId: role },
        ]);
      });

      it("stores an inheritance as its roles' rows spell them", async () => {
        await boot(dialect);
        const parent = await makeRole("parent");
        const child = await makeRole("child");

        await services().roleInheritance.addRoleInheritance(
          child.toUpperCase(),
          parent.toUpperCase()
        );

        expect(await edges(parent, child)).toEqual([
          {
            id: `${parent}::${child}`,
            parentRoleId: parent,
            childRoleId: child,
          },
        ]);
      });

      it("stores a role's new children under the role's own id", async () => {
        await boot(dialect);
        const parent = await makeRole("updated");
        const child = await makeRole("updated-child");

        await services().roles.updateRole(parent.toUpperCase(), {
          childRoleIds: [child],
        });

        const stored = await edges(parent, child);
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({
          parentRoleId: parent,
          childRoleId: child,
        });
      });

      it("refuses a role inheriting itself, named in another case", async () => {
        await boot(dialect);
        const role = await makeRole("itself");

        await expect(
          services().roleInheritance.addRoleInheritance(
            role,
            role.toUpperCase()
          )
        ).rejects.toThrow("INHERIT_SELF_FORBIDDEN");
        expect(await edges(role, role)).toEqual([]);
      });
    });
  }
);
