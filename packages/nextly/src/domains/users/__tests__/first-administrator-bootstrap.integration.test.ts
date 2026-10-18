// Who becomes the install's first administrator.
//
// An account the app itself provisions (its setup route, its admin, its own
// server code) on an install with no administrator becomes super-admin: that is
// how a fresh install gets one. A stranger's self-registration never does,
// whoever was there before it, and two provisioned accounts racing on an empty
// install leave exactly one administrator.

import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { ServiceContainer } from "../../../services/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  if (dialect === "sqlite") {
    // The SQLite runtime auto-sync does not create the core auth tables.
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  return current;
}

function services(t: TestNextly) {
  return new ServiceContainer(t.adapter);
}

const PASSWORD = "Str0ng-P@ssw0rd!";

/** A hand-provisioned account: the app's own caller. */
async function provision(t: TestNextly, email: string): Promise<string> {
  const created = await services(t).users.createLocalUser({
    email,
    name: email,
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

/** A self-registered account, as the register route creates it. */
async function selfRegister(t: TestNextly, email: string): Promise<string> {
  const created = await services(t).users.createLocalUser(
    {
      email,
      name: email,
      password: PASSWORD,
      emailVerification: "pending",
    },
    undefined,
    "self-registration"
  );
  return String(created.id);
}

async function isAdministrator(t: TestNextly, userId: string) {
  const { id } = await services(t).roles.ensureSuperAdminRole();
  return (await services(t).userRoles.listUserRoles(userId)).includes(id);
}

describe.each(getConfiguredTestDialects())(
  "the first administrator (%s)",
  (dialect: TestDialect) => {
    it("makes the first hand-provisioned account the administrator", async () => {
      const t = await boot(dialect);
      const id = await provision(t, "owner@example.com");
      expect(await isAdministrator(t, id)).toBe(true);
    });

    it("never makes a self-registered account the administrator, even the first", async () => {
      const t = await boot(dialect);
      const id = await selfRegister(t, "stranger@example.com");
      expect(await services(t).userRoles.listUserRoles(id)).toEqual([]);
    });

    it("never makes the administrator through the registration service, even on an empty install", async () => {
      // The register route's path to an account: the service it calls, not a
      // stand-in, so a registration that stopped saying what it is would show.
      const t = await boot(dialect);
      const registered = await services(t).auth.registerUser({
        email: "stranger@example.com",
        name: "Stranger",
        password: PASSWORD,
      });
      expect(
        await services(t).userRoles.listUserRoles(String(registered.id))
      ).toEqual([]);
    });

    it("still makes a hand-provisioned account the administrator after a self-registered one", async () => {
      const t = await boot(dialect);
      await selfRegister(t, "stranger@example.com");
      const id = await provision(t, "owner@example.com");
      expect(await isAdministrator(t, id)).toBe(true);
    });

    it("gives a hand-provisioned account only its own roles once an administrator exists", async () => {
      const t = await boot(dialect);
      await provision(t, "owner@example.com");
      const id = await provision(t, "colleague@example.com");
      expect(await services(t).userRoles.listUserRoles(id)).toEqual([]);
    });

    it("leaves exactly one administrator when two hand-provisioned accounts race on an empty install", async () => {
      const t = await boot(dialect);
      const ids = await Promise.all([
        provision(t, "first@example.com"),
        provision(t, "second@example.com"),
      ]);
      const admins = await Promise.all(ids.map(id => isAdministrator(t, id)));
      expect(admins.filter(Boolean)).toHaveLength(1);
    });
  }
);
