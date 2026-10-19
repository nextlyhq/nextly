/**
 * A value already held in a unique custom user field is refused, on every
 * configured dialect, and the user's other custom fields keep being written.
 *
 * The write paths treated any failure of the `user_ext` write as "the table is
 * not there yet": creating a user retried without its custom fields and turned
 * them off for the rest of the process, and an update logged and carried on.
 * Once a unique field has its index, a duplicate value is the likeliest such
 * failure, so it silently dropped the user's custom fields.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../../../cli/utils/logger";
import { provisionUserFieldTables } from "../../../cli/commands/migrate";
import { text } from "../../../collections/fields/helpers";
import { getDialectTables } from "../../../database/index";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { UserExtSchemaService } from "../services/user-ext-schema-service";
import { UserFieldDefinitionService } from "../services/user-field-definition-service";
import { UserMutationService } from "../services/user-mutation-service";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const FIELDS = [
  text({ name: "employeeId", unique: true }),
  text({ name: "team" }),
];

describe.each(getConfiguredTestDialects())(
  "a unique custom user field's taken value (%s)",
  dialect => {
    let handle: TestNextly;
    let users: UserMutationService;
    const q = dialect === "mysql" ? "`" : '"';

    /** The custom field values stored for a user, read from user_ext. */
    async function stored(
      userId: unknown
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await handle.adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q}employee_id${q} AS employee, ${q}team${q} AS team FROM ${q}user_ext${q} WHERE ${q}user_id${q} = '${String(userId)}'`
      );
      return rows[0];
    }

    function create(email: string, employeeId: string, team: string) {
      return users.createLocalUser({
        email,
        name: email,
        password: "TestPassword123!",
        isActive: true,
        employeeId,
        team,
      } as Parameters<UserMutationService["createLocalUser"]>[0]);
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // A sentinel account, so createLocalUser never takes the install's
      // first-account branch.
      const now = new Date();
      const tables = getDialectTables(dialect);
      await (
        handle.adapter.getDrizzle() as unknown as {
          insert(t: unknown): { values(v: unknown): Promise<unknown> };
        }
      )
        .insert(tables.users)
        .values({
          id: "sentinel",
          email: "sentinel@test.local",
          name: "Sentinel",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      // The table and its unique index, as `nextly migrate` makes them.
      await provisionUserFieldTables(
        { fields: FIELDS },
        handle.adapter,
        createLogger({ quiet: true })
      );
      const schema = new UserExtSchemaService(
        dialect,
        new UserFieldDefinitionService(handle.adapter, silentLogger),
        silentLogger
      );
      await schema.loadMergedFields();
      users = new UserMutationService(
        handle.adapter,
        silentLogger,
        { fields: FIELDS },
        schema
      );
    });

    afterEach(async () => {
      await handle?.destroy();
    });

    it("refuses to create a user with a value another user holds, and keeps writing custom fields after", async () => {
      await create("first@test.local", "E1", "red");

      const error = await create("second@test.local", "E1", "blue").catch(
        (e: unknown) => e
      );
      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).code).toBe("DUPLICATE");
      // What is logged names the constraint or column, never the value: a
      // custom field may hold personal data.
      const logged = JSON.stringify((error as NextlyError).logContext);
      expect(logged).not.toContain("E1");
      expect(logged).toMatch(/uq_user_ext_employee_id|user_ext\.employee_id/);

      // The service still writes custom fields: it took the refusal for what
      // it is, not for a missing table.
      const third = await create("third@test.local", "E3", "green");
      expect(await stored(third.id)).toMatchObject({
        employee: "E3",
        team: "green",
      });
    });

    it("refuses to update a user to a value another user holds, and leaves theirs as it was", async () => {
      await create("first@test.local", "E1", "red");
      const other = await create("other@test.local", "E2", "blue");

      const error = await users
        .updateUser(String(other.id), {
          employeeId: "E1",
        } as Parameters<UserMutationService["updateUser"]>[1])
        .catch((e: unknown) => e);
      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).code).toBe("DUPLICATE");
      // What is logged names the constraint or column, never the value: a
      // custom field may hold personal data.
      const logged = JSON.stringify((error as NextlyError).logContext);
      expect(logged).not.toContain("E1");
      expect(logged).toMatch(/uq_user_ext_employee_id|user_ext\.employee_id/);
      expect(await stored(other.id)).toMatchObject({ employee: "E2" });

      // A later update still reaches user_ext.
      await users.updateUser(String(other.id), {
        team: "violet",
      } as Parameters<UserMutationService["updateUser"]>[1]);
      expect(await stored(other.id)).toMatchObject({ team: "violet" });
    });
  }
);
