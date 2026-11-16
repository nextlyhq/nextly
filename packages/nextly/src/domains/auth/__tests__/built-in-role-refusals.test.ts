/**
 * A role built into Nextly is refused a change or a delete in words that say
 * so: "This role is built in, so it can't be changed." It is a fact about the
 * role, not about the caller's permissions, so the caller is told it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../../__tests__/fixtures/db";
import {
  roleFactory,
  systemRoleFactory,
} from "../../../__tests__/fixtures/roles";
import { RoleInheritanceService } from "../services/role-inheritance-service";
import { RoleService } from "../services/role-service";

describe("a built-in role", () => {
  let testDb: TestDb;
  let roles: RoleService;
  let systemRoleId: string;
  let customRoleId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    roles = new RoleService(testDb.adapter, testLogger);
    const system = systemRoleFactory({ name: "Built In", level: 10 });
    const custom = roleFactory({ name: "Custom", level: 5 });
    // The column is a boolean; the fixtures write SQLite's 0 and 1.
    await testDb.db.insert(testDb.schema.roles).values([
      { ...system, isSystem: true },
      { ...custom, isSystem: false },
    ]);
    systemRoleId = system.id;
    customRoleId = custom.id;
  });

  afterEach(async () => {
    await testDb.reset();
    await testDb.close();
  });

  it("is refused a change, and told why", async () => {
    await expect(
      roles.updateRole(systemRoleId, { description: "renamed" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage: "This role is built in, so it can't be changed.",
    });
  });

  it("is refused a delete, and told why", async () => {
    await expect(roles.deleteRole(systemRoleId)).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage: "This role is built in, so it can't be deleted.",
    });
  });

  it("is refused a change to its inheritance, and told why", async () => {
    // Adding a child under a built-in role changes what that role holds.
    const inheritance = new RoleInheritanceService(testDb.adapter, testLogger);
    await expect(
      inheritance.addRoleInheritance(customRoleId, systemRoleId)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage: "This role is built in, so it can't be changed.",
    });
  });
});
